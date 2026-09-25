import type pg from 'pg';
import { canonicalJson, redact, sha256Hex } from '../../common/util.js';
import type { RequestMeta } from '../../http/types.js';

export const AUDIT_ACTIONS = [
  'CREATE', 'UPDATE', 'SUBMIT', 'VERIFY', 'APPROVE', 'REJECT', 'PAY', 'CANCEL', 'VOID', 'REVERSE', 'TRANSFER',
  'ADJUST', 'HOLD', 'RELEASE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'EXPORT', 'SETTING_CHANGE',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  userId: string | null;
  action: AuditAction;
  module: string;
  entityType: string;
  entityId?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  meta?: Partial<RequestMeta>;
}

// Serialises writers of the hash chain for the duration of their transaction.
const AUDIT_CHAIN_LOCK = 7_310_442_902;

/** The exact fields covered by the hash (order-independent via canonical JSON). */
export function auditHashInput(prevHash: string | null, row: {
  userId: string | null; action: string; module: string; entityType: string; entityId: string | null;
  previousValue: unknown; newValue: unknown; ipAddress: string | null; userAgent: string | null;
  requestId: string | null; createdAt: string;
}): string {
  return (prevHash ?? '') + canonicalJson(row);
}

/**
 * Hash-chained, append-only audit log (ARCHITECTURE.md §2.2, §14).
 * Must be called with a client inside the caller's transaction, so the audit row
 * commits or rolls back with the business change.
 * hash = sha256(prevHash || canonical(row)); tampering with any row breaks
 * verification of every later row.
 */
export class AuditLogService {
  async record(tx: pg.PoolClient, e: AuditEntry): Promise<void> {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_CHAIN_LOCK]);
    const last = await tx.query<{ hash: string }>('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1');
    const prevHash = last.rows[0]?.hash ?? null;
    const row = {
      userId: e.userId,
      action: e.action,
      module: e.module,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      previousValue: e.previousValue === undefined ? null : redact(e.previousValue),
      newValue: e.newValue === undefined ? null : redact(e.newValue),
      ipAddress: e.meta?.ipAddress ?? null,
      userAgent: e.meta?.userAgent ?? null,
      requestId: e.meta?.requestId ?? null,
      createdAt: new Date().toISOString(),
    };
    const hash = sha256Hex(auditHashInput(prevHash, row));
    await tx.query(
      `INSERT INTO audit_logs (user_id, action, module, entity_type, entity_id, previous_value, new_value,
                               ip_address, user_agent, request_id, prev_hash, hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        row.userId, row.action, row.module, row.entityType, row.entityId,
        row.previousValue === null ? null : JSON.stringify(row.previousValue),
        row.newValue === null ? null : JSON.stringify(row.newValue),
        row.ipAddress, row.userAgent, row.requestId, prevHash, hash, row.createdAt,
      ],
    );
  }

  /**
   * Recomputes the chain from the first row. Returns the first broken row, if any.
   * Reads in pages so it works on large logs.
   */
  async verify(db: pg.Pool | pg.PoolClient, pageSize = 1000): Promise<{ valid: boolean; checked: number; brokenAtId?: string; reason?: string }> {
    let prevHash: string | null = null;
    let lastId = '0';
    let checked = 0;
    for (;;) {
      const { rows } = await db.query(
        `SELECT id, user_id, action, module, entity_type, entity_id, previous_value, new_value, ip_address,
                user_agent, request_id, prev_hash, hash, created_at
           FROM audit_logs WHERE id > $1 ORDER BY id LIMIT $2`,
        [lastId, pageSize],
      );
      if (rows.length === 0) break;
      for (const r of rows) {
        if ((r.prev_hash ?? null) !== prevHash) {
          return { valid: false, checked, brokenAtId: String(r.id), reason: 'prev_hash does not match previous row' };
        }
        const expected = sha256Hex(
          auditHashInput(prevHash, {
            userId: r.user_id, action: r.action, module: r.module, entityType: r.entity_type, entityId: r.entity_id,
            previousValue: r.previous_value, newValue: r.new_value, ipAddress: r.ip_address, userAgent: r.user_agent,
            requestId: r.request_id, createdAt: (r.created_at as Date).toISOString(),
          }),
        );
        if (expected !== r.hash) return { valid: false, checked, brokenAtId: String(r.id), reason: 'hash mismatch' };
        prevHash = r.hash;
        lastId = String(r.id);
        checked++;
      }
    }
    return { valid: true, checked };
  }
}
