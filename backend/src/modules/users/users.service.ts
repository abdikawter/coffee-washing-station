import type pg from 'pg';
import { BusinessRuleError, ForbiddenError, NotFoundError, ValidationError } from '../../common/errors.js';
import type { AuditLogService } from '../../core/audit-log/audit-log.service.js';
import { camelize, withTransaction } from '../../db/pool.js';
import { orderBy, pageClause, type PageQuery } from '../../http/schemas.js';
import type { AuthUser, RequestMeta } from '../../http/types.js';
import type { AuthService } from '../auth/auth.service.js';
import { hashPassword } from '../auth/password.js';

export interface UserView {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
  mustChangePassword: boolean;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  roles: string[];
  createdAt: Date;
  updatedAt: Date;
}

const USER_SELECT = `
  SELECT u.id, u.username, u.email, u.full_name, u.phone, u.status, u.must_change_password, u.locked_until,
         u.last_login_at, u.created_at, u.updated_at,
         COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id`;

const SORT_COLUMNS = { username: 'u.username', fullName: 'u.full_name', createdAt: 'u.created_at', lastLoginAt: 'u.last_login_at' };

/** Guards that keep the system administrable. */
async function activeSuperAdminCount(tx: pg.PoolClient, excludingUserId?: string): Promise<number> {
  const { rows } = await tx.query(
    `SELECT count(DISTINCT u.id)::int AS n FROM users u
       JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
      WHERE r.code = 'SUPER_ADMIN' AND u.status <> 'INACTIVE' AND ($1::uuid IS NULL OR u.id <> $1::uuid)`,
    [excludingUserId ?? null],
  );
  return rows[0].n;
}

export class UsersService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditLogService,
    private readonly auth: AuthService,
  ) {}

  async list(q: PageQuery & { status?: string; role?: string; search?: string }): Promise<{ data: UserView[]; total: number }> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.status) { args.push(q.status); where.push(`u.status = $${args.length}`); }
    if (q.search) { args.push(`%${q.search.toLowerCase()}%`); where.push(`(u.username LIKE $${args.length} OR lower(u.full_name) LIKE $${args.length})`); }
    if (q.role) {
      args.push(q.role);
      where.push(`EXISTS (SELECT 1 FROM user_roles x JOIN roles y ON y.id = x.role_id WHERE x.user_id = u.id AND y.code = $${args.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { limit, offset } = pageClause(q);
    const [rows, count] = await Promise.all([
      this.pool.query(`${USER_SELECT} ${whereSql} GROUP BY u.id ORDER BY ${orderBy(q.sort, SORT_COLUMNS)}, u.id LIMIT ${limit} OFFSET ${offset}`, args),
      this.pool.query(`SELECT count(*)::int AS n FROM users u ${whereSql}`, args),
    ]);
    return { data: rows.rows.map((r) => camelize<UserView>(r)), total: count.rows[0].n };
  }

  async get(id: string, db: pg.Pool | pg.PoolClient = this.pool): Promise<UserView> {
    const { rows } = await db.query(`${USER_SELECT} WHERE u.id = $1 GROUP BY u.id`, [id]);
    if (!rows[0]) throw new NotFoundError('User', id);
    return camelize<UserView>(rows[0]);
  }

  private async roleIds(tx: pg.PoolClient, codes: string[]): Promise<Map<string, string>> {
    const { rows } = await tx.query(`SELECT id, code FROM roles WHERE code = ANY($1)`, [codes]);
    const map = new Map<string, string>(rows.map((r) => [r.code, r.id]));
    const unknown = codes.filter((c) => !map.has(c));
    if (unknown.length) throw new ValidationError([{ location: 'body', path: 'roleCodes', message: `Unknown role(s): ${unknown.join(', ')}` }]);
    return map;
  }

  async create(
    actor: AuthUser,
    input: { username: string; fullName: string; email?: string | null; phone?: string | null; roleCodes: string[]; temporaryPassword: string },
    meta: RequestMeta,
  ): Promise<UserView> {
    const username = input.username.trim().toLowerCase();
    return withTransaction(this.pool, async (tx) => {
      await this.auth.assertPasswordAcceptable(tx, input.temporaryPassword, username);
      const roles = await this.roleIds(tx, input.roleCodes);
      const { rows } = await tx.query(
        `INSERT INTO users (username, email, full_name, phone, password_hash, must_change_password)
         VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [username, input.email?.toLowerCase() ?? null, input.fullName.trim(), input.phone ?? null, await hashPassword(input.temporaryPassword)],
      );
      const id = rows[0].id as string;
      for (const roleId of roles.values()) await tx.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [id, roleId]);
      const created = await this.get(id, tx);
      await this.audit.record(tx, { userId: actor.id, action: 'CREATE', module: 'users', entityType: 'User', entityId: id, newValue: created, meta });
      return created;
    });
  }

  async update(actor: AuthUser, id: string, input: { fullName?: string; email?: string | null; phone?: string | null }, meta: RequestMeta): Promise<UserView> {
    return withTransaction(this.pool, async (tx) => {
      const before = await this.get(id, tx);
      await tx.query(
        `UPDATE users SET full_name = COALESCE($2, full_name),
                          email = CASE WHEN $5 THEN $3 ELSE email END,
                          phone = CASE WHEN $6 THEN $4 ELSE phone END
          WHERE id = $1`,
        [id, input.fullName?.trim() ?? null, input.email?.toLowerCase() ?? null, input.phone ?? null, input.email !== undefined, input.phone !== undefined],
      );
      const after = await this.get(id, tx);
      await this.audit.record(tx, {
        userId: actor.id, action: 'UPDATE', module: 'users', entityType: 'User', entityId: id,
        previousValue: { fullName: before.fullName, email: before.email, phone: before.phone },
        newValue: { fullName: after.fullName, email: after.email, phone: after.phone }, meta,
      });
      return after;
    });
  }

  async setRoles(actor: AuthUser, id: string, roleCodes: string[], reason: string, meta: RequestMeta): Promise<UserView> {
    return withTransaction(this.pool, async (tx) => {
      await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id]);
      const before = await this.get(id, tx);
      const roles = await this.roleIds(tx, roleCodes);
      if (before.roles.includes('SUPER_ADMIN') && !roleCodes.includes('SUPER_ADMIN') && (await activeSuperAdminCount(tx, id)) === 0) {
        throw new BusinessRuleError('LAST_SUPER_ADMIN', 'At least one active SUPER_ADMIN must remain');
      }
      await tx.query('DELETE FROM user_roles WHERE user_id = $1', [id]);
      for (const roleId of roles.values()) await tx.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [id, roleId]);
      const after = await this.get(id, tx);
      await this.audit.record(tx, {
        userId: actor.id, action: 'UPDATE', module: 'users', entityType: 'UserRole', entityId: id,
        previousValue: { roles: before.roles }, newValue: { roles: after.roles, reason }, meta,
      });
      return after;
    });
  }

  async setStatus(actor: AuthUser, id: string, action: 'deactivate' | 'activate' | 'unlock', reason: string, meta: RequestMeta): Promise<UserView> {
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query('SELECT id, status FROM users WHERE id = $1 FOR UPDATE', [id]);
      if (!rows[0]) throw new NotFoundError('User', id);
      const before = await this.get(id, tx);
      if (action === 'deactivate') {
        if (id === actor.id) throw new ForbiddenError('You cannot deactivate your own account', 'SELF_DEACTIVATION');
        if (before.roles.includes('SUPER_ADMIN') && (await activeSuperAdminCount(tx, id)) === 0) {
          throw new BusinessRuleError('LAST_SUPER_ADMIN', 'At least one active SUPER_ADMIN must remain');
        }
        await tx.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [id]);
        await tx.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
      } else if (action === 'activate') {
        if (before.status !== 'INACTIVE') throw new BusinessRuleError('USER_NOT_INACTIVE', 'Only inactive users can be activated');
        await tx.query(`UPDATE users SET status = 'ACTIVE', failed_login_count = 0, locked_until = NULL WHERE id = $1`, [id]);
      } else {
        if (before.status !== 'LOCKED') throw new BusinessRuleError('USER_NOT_LOCKED', 'The user is not locked');
        await tx.query(`UPDATE users SET status = 'ACTIVE', failed_login_count = 0, locked_until = NULL WHERE id = $1`, [id]);
      }
      const after = await this.get(id, tx);
      await this.audit.record(tx, {
        userId: actor.id, action: 'UPDATE', module: 'users', entityType: 'User', entityId: id,
        previousValue: { status: before.status }, newValue: { status: after.status, action, reason }, meta,
      });
      return after;
    });
  }

  async resetPassword(actor: AuthUser, id: string, temporaryPassword: string, reason: string, meta: RequestMeta): Promise<UserView> {
    return withTransaction(this.pool, async (tx) => {
      const before = await this.get(id, tx);
      await this.auth.assertPasswordAcceptable(tx, temporaryPassword, before.username);
      await tx.query(
        `UPDATE users SET password_hash = $2, must_change_password = true, failed_login_count = 0, locked_until = NULL,
                          status = CASE WHEN status = 'LOCKED' THEN 'ACTIVE'::user_status ELSE status END
          WHERE id = $1`,
        [id, await hashPassword(temporaryPassword)],
      );
      await tx.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
      await this.audit.record(tx, {
        userId: actor.id, action: 'UPDATE', module: 'users', entityType: 'User', entityId: id,
        newValue: { passwordReset: true, mustChangePassword: true, reason }, meta,
      });
      return this.get(id, tx);
    });
  }
}
