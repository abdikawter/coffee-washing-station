import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { ForbiddenError, NotFoundError, ValidationError } from '../../common/errors.js';
import { sha256Hex } from '../../common/util.js';
import type { AuditLogService } from '../../core/audit-log/audit-log.service.js';
import { sniffMime, type StorageAdapter } from '../../core/storage/storage.js';
import { camelize, withTransaction } from '../../db/pool.js';
import type { Api } from '../../http/api.js';
import { single, uuidParam } from '../../http/schemas.js';

export const DOCUMENT_CATEGORIES = [
  'SUPPLIER_ID', 'RECEIPT', 'QUALITY', 'CALIBRATION', 'AUDIT_EVIDENCE', 'CORRECTIVE_ACTION_EVIDENCE',
  'PAYROLL', 'SIGNATURE', 'THUMBPRINT', 'REPORT', 'OTHER',
] as const;

const documentSchema = z
  .object({
    id: z.uuid(), category: z.enum(DOCUMENT_CATEGORIES), provider: z.enum(['LOCAL', 'S3']), originalName: z.string(),
    mimeType: z.string(), sizeBytes: z.number().int(), sha256: z.string(), entityType: z.string().nullable(),
    entityId: z.uuid().nullable(), uploadedById: z.uuid(), createdAt: z.date(),
  })
  .meta({ id: 'Document' });

type DocumentRow = z.infer<typeof documentSchema> & { storageKey: string };

function present(d: DocumentRow) {
  const { storageKey: _k, ...rest } = d;
  return rest;
}

/**
 * Files (ARCHITECTURE.md §14 "Files"): type identified by magic bytes, size
 * limit, SHA-256, random storage keys outside any web root, downloads only
 * through this authorized endpoint (LOCAL: streamed; S3: 5-minute presigned URL).
 * Readers: the uploader, or anyone with `file:read`.
 */
export function registerFileRoutes(api: Api, pool: pg.Pool, storage: StorageAdapter, audit: AuditLogService, maxBytes: number): void {
  async function load(id: string): Promise<DocumentRow> {
    const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [id]);
    if (!rows[0]) throw new NotFoundError('Document', id);
    return camelize<DocumentRow>(rows[0]);
  }

  api.route('Files', {
    method: 'post', path: '/files', summary: 'Upload a document',
    description: `multipart/form-data with field \`file\` (PDF, PNG, JPEG or WebP, max ${Math.round(maxBytes / 1048576)} MB).`,
    access: { permission: 'file:upload' },
    upload: { field: 'file', maxBytes },
    body: z.object({
      category: z.enum(DOCUMENT_CATEGORIES),
      entityType: z.string().regex(/^[A-Za-z]+$/).max(60).optional(),
      entityId: z.uuid().optional(),
    }).strict(),
    response: { status: 201, description: 'Stored', schema: single(documentSchema) },
    handler: async ({ body, file, user, meta }) => {
      if (!file) throw new ValidationError([{ location: 'body', path: 'file', message: 'file is required' }]);
      const type = sniffMime(file.buffer);
      if (!type) throw new ValidationError([{ location: 'body', path: 'file', message: 'Only PDF, PNG, JPEG and WebP files are accepted' }]);
      const now = new Date();
      const storageKey = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${type.ext}`;
      await storage.put(storageKey, file.buffer, type.mime);
      const doc = await withTransaction(pool, async (tx) => {
        const { rows } = await tx.query(
          `INSERT INTO documents (category, provider, storage_key, original_name, mime_type, size_bytes, sha256, entity_type, entity_id, uploaded_by_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [body.category, storage.provider, storageKey, file.originalname.slice(0, 200), type.mime, file.size, sha256Hex(file.buffer),
            body.entityType ?? null, body.entityId ?? null, user.id],
        );
        const d = camelize<DocumentRow>(rows[0]);
        await audit.record(tx, { userId: user.id, action: 'CREATE', module: 'files', entityType: 'Document', entityId: d.id, newValue: present(d), meta });
        return d;
      });
      return { data: present(doc) };
    },
  });

  const canRead = (d: DocumentRow, userId: string, perms: Set<string>) => d.uploadedById === userId || perms.has('file:read');

  api.route('Files', {
    method: 'get', path: '/files/:id', summary: 'Document metadata',
    access: { permission: ['file:upload', 'file:read'] }, params: uuidParam,
    response: { status: 200, description: 'Metadata', schema: single(documentSchema) },
    handler: async ({ params, user }) => {
      const d = await load(params.id);
      if (!canRead(d, user.id, user.permissions)) throw new ForbiddenError();
      return { data: present(d) };
    },
  });

  api.route('Files', {
    method: 'get', path: '/files/:id/content', summary: 'Download a document',
    description: 'LOCAL storage streams the file; S3 storage redirects (302) to a 5-minute presigned URL.',
    access: { permission: ['file:upload', 'file:read'] }, params: uuidParam,
    response: { status: 200, description: 'File content', contentType: 'application/octet-stream' },
    handler: async ({ params, user, res }) => {
      const d = await load(params.id);
      if (!canRead(d, user.id, user.permissions)) throw new ForbiddenError();
      const out = await storage.get(d.storageKey, { fileName: d.originalName, contentType: d.mimeType });
      if ('url' in out) {
        res.redirect(302, out.url);
        return;
      }
      res.setHeader('Content-Type', d.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${d.originalName.replace(/[^\w.-]/g, '_')}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      await new Promise<void>((resolve, reject) => {
        out.stream.on('error', reject).on('end', resolve).pipe(res);
      });
    },
  });
}
