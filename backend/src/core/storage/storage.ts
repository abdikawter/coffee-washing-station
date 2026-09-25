import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Storage adapter (ARCHITECTURE.md §2.2). LOCAL for development; S3 for Render
 * (Render has no object store — use any S3-compatible service).
 */
export interface StorageAdapter {
  readonly provider: 'LOCAL' | 'S3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Stream for LOCAL; S3 returns a short-lived presigned URL instead. */
  get(key: string, opts: { fileName: string; contentType: string }): Promise<{ stream: Readable } | { url: string }>;
}

function safeKey(key: string): string {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes('..')) throw new Error('invalid storage key');
  return key;
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly provider = 'LOCAL' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = path.join(this.root, safeKey(key));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, { flag: 'wx' });
  }

  async get(key: string): Promise<{ stream: Readable }> {
    const file = path.join(this.root, safeKey(key));
    await stat(file);
    return { stream: createReadStream(file) };
  }
}

export interface S3Options {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export class S3StorageAdapter implements StorageAdapter {
  readonly provider = 'S3' as const;
  private readonly client: S3Client;

  constructor(private readonly opts: S3Options) {
    this.client = new S3Client({
      region: opts.region,
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      forcePathStyle: opts.forcePathStyle,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.opts.bucket, Key: safeKey(key), Body: body, ContentType: contentType }));
  }

  async get(key: string, opts: { fileName: string; contentType: string }): Promise<{ url: string }> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.opts.bucket,
        Key: safeKey(key),
        ResponseContentType: opts.contentType,
        ResponseContentDisposition: `attachment; filename="${opts.fileName.replace(/[^\w.-]/g, '_')}"`,
      }),
      { expiresIn: 300 },
    );
    return { url };
  }
}

/** Allowed upload types, identified by magic bytes — never by extension or client MIME. */
export const ALLOWED_TYPES = [
  { mime: 'application/pdf', ext: 'pdf', test: (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', ext: 'png', test: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', ext: 'webp', test: (b: Buffer) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
] as const;

export function sniffMime(buf: Buffer): { mime: string; ext: string } | undefined {
  const t = ALLOWED_TYPES.find((x) => x.test(buf));
  return t ? { mime: t.mime, ext: t.ext } : undefined;
}
