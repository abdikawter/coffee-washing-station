import type pg from 'pg';
import { z } from 'zod';
import { AUDIT_ACTIONS, type AuditLogService } from '../../core/audit-log/audit-log.service.js';
import { camelizeRows } from '../../db/pool.js';
import type { Api } from '../../http/api.js';
import { isoDateTime, list, orderBy, pageClause, pagination, single } from '../../http/schemas.js';

const entrySchema = z
  .object({
    id: z.string().meta({ description: 'bigint as string' }),
    userId: z.uuid().nullable(),
    username: z.string().nullable(),
    action: z.enum(AUDIT_ACTIONS),
    module: z.string(),
    entityType: z.string(),
    entityId: z.string().nullable(),
    previousValue: z.unknown(),
    newValue: z.unknown(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    requestId: z.string().nullable(),
    hash: z.string(),
    createdAt: z.date(),
  })
  .meta({ id: 'AuditLogEntry' });

export function registerAuditLogRoutes(api: Api, pool: pg.Pool, audit: AuditLogService): void {
  api.route('Audit log', {
    method: 'get', path: '/audit-logs', summary: 'Search the audit log',
    access: { permission: 'auditlog:read' },
    query: pagination(['createdAt'] as const, '-createdAt').extend({
      userId: z.uuid().optional(),
      action: z.enum(AUDIT_ACTIONS).optional(),
      module: z.string().max(50).optional(),
      entityType: z.string().max(80).optional(),
      entityId: z.string().max(80).optional(),
      from: isoDateTime.optional(),
      to: isoDateTime.optional(),
    }).strict(),
    response: { status: 200, description: 'Page of audit entries', schema: list(entrySchema) },
    handler: async ({ query }) => {
      const where: string[] = [];
      const args: unknown[] = [];
      const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)); };
      if (query.userId) add('a.user_id = ?', query.userId);
      if (query.action) add('a.action = ?', query.action);
      if (query.module) add('a.module = ?', query.module);
      if (query.entityType) add('a.entity_type = ?', query.entityType);
      if (query.entityId) add('a.entity_id = ?', query.entityId);
      if (query.from) add('a.created_at >= ?', query.from);
      if (query.to) add('a.created_at < ?', query.to);
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { limit, offset } = pageClause(query);
      const [rows, count] = await Promise.all([
        pool.query(
          `SELECT a.id, a.user_id, u.username, a.action, a.module, a.entity_type, a.entity_id, a.previous_value, a.new_value,
                  a.ip_address, a.user_agent, a.request_id, a.hash, a.created_at
             FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${w}
            ORDER BY ${orderBy(query.sort, { createdAt: 'a.id' })} LIMIT ${limit} OFFSET ${offset}`,
          args,
        ),
        pool.query(`SELECT count(*)::int AS n FROM audit_logs a ${w}`, args),
      ]);
      return { data: camelizeRows(rows.rows), meta: { page: query.page, pageSize: query.pageSize, total: count.rows[0].n } };
    },
  });

  api.route('Audit log', {
    method: 'get', path: '/audit-logs/verify', summary: 'Verify the hash chain of the whole audit log',
    access: { permission: 'auditlog:read' },
    response: {
      status: 200, description: 'Verification result',
      schema: single(z.object({ valid: z.boolean(), checked: z.number().int(), brokenAtId: z.string().optional(), reason: z.string().optional() })),
    },
    handler: async () => ({ data: await audit.verify(pool) }),
  });
}
