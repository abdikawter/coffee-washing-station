import type pg from 'pg';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../common/errors.js';
import type { AuditLogService } from '../../core/audit-log/audit-log.service.js';
import { camelizeRows, withTransaction } from '../../db/pool.js';
import type { AuthUser, RequestMeta } from '../../http/types.js';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, permissionAction, permissionModule, type RoleCode } from './catalog.js';

/** Permissions the SUPER_ADMIN role must always keep, so the system stays administrable. */
const SUPER_ADMIN_LOCKED = ['user:read', 'user:manage', 'role:read', 'role:manage'];

export interface RoleView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissions: string[];
}

export class RolesService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditLogService,
  ) {}

  async listRoles(db: pg.Pool | pg.PoolClient = this.pool): Promise<RoleView[]> {
    const { rows } = await db.query(`
      SELECT r.id, r.code, r.name, r.description, r.is_system,
             (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = r.id) AS user_count,
             COALESCE(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
        FROM roles r
        LEFT JOIN role_permissions rp ON rp.role_id = r.id
        LEFT JOIN permissions p ON p.id = rp.permission_id
       GROUP BY r.id ORDER BY r.code`);
    return camelizeRows<RoleView>(rows);
  }

  async listPermissions(): Promise<{ id: string; code: string; module: string; action: string; description: string | null }[]> {
    const { rows } = await this.pool.query(`SELECT id, code, module, action, description FROM permissions ORDER BY module, code`);
    return camelizeRows(rows);
  }

  async setRolePermissions(actor: AuthUser, roleId: string, codes: string[], reason: string, meta: RequestMeta): Promise<RoleView> {
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query('SELECT id, code FROM roles WHERE id = $1 FOR UPDATE', [roleId]);
      const role = rows[0];
      if (!role) throw new NotFoundError('Role', roleId);
      const unique = [...new Set(codes)];
      const perms = await tx.query(`SELECT id, code FROM permissions WHERE code = ANY($1)`, [unique]);
      const found = new Set(perms.rows.map((p) => p.code));
      const unknown = unique.filter((c) => !found.has(c));
      if (unknown.length) throw new ValidationError([{ location: 'body', path: 'permissionCodes', message: `Unknown permission(s): ${unknown.join(', ')}` }]);
      if (role.code === 'SUPER_ADMIN') {
        const missing = SUPER_ADMIN_LOCKED.filter((c) => !found.has(c));
        if (missing.length) throw new BusinessRuleError('SUPER_ADMIN_LOCKOUT', `SUPER_ADMIN must keep: ${missing.join(', ')}`);
      }
      const before = (await this.listRoles(tx)).find((r) => r.id === roleId)!;
      await tx.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
      for (const p of perms.rows) await tx.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [roleId, p.id]);
      const after = (await this.listRoles(tx)).find((r) => r.id === roleId)!;
      await this.audit.record(tx, {
        userId: actor.id, action: 'UPDATE', module: 'roles', entityType: 'RolePermission', entityId: roleId,
        previousValue: { role: role.code, permissions: before.permissions },
        newValue: {
          role: role.code, permissions: after.permissions, reason,
          added: after.permissions.filter((p) => !before.permissions.includes(p)),
          removed: before.permissions.filter((p) => !after.permissions.includes(p)),
        },
        meta,
      });
      return after;
    });
  }

  /**
   * Idempotent seed of the catalog. New roles receive their full default set; new
   * permissions are granted to the roles that list them. Existing assignments
   * changed by an administrator are left alone.
   */
  static async seedCatalog(tx: pg.PoolClient): Promise<{ rolesCreated: number; permissionsCreated: number; grants: number }> {
    let rolesCreated = 0;
    let permissionsCreated = 0;
    let grants = 0;
    const newRoles = new Set<string>();
    const newPerms = new Set<string>();
    for (const [code, r] of Object.entries(ROLES)) {
      const res = await tx.query(
        `INSERT INTO roles (code, name, description, is_system) VALUES ($1, $2, $3, true) ON CONFLICT (code) DO NOTHING RETURNING id`,
        [code, r.name, r.description],
      );
      if (res.rowCount) { rolesCreated++; newRoles.add(code); }
    }
    for (const [code, description] of Object.entries(PERMISSIONS)) {
      const res = await tx.query(
        `INSERT INTO permissions (code, module, action, description) VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description RETURNING (xmax = 0) AS inserted`,
        [code, permissionModule(code), permissionAction(code), description],
      );
      if (res.rows[0]?.inserted) { permissionsCreated++; newPerms.add(code); }
    }
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS) as [RoleCode, string[]][]) {
      for (const perm of new Set(perms)) {
        if (!newRoles.has(role) && !newPerms.has(perm)) continue;
        const res = await tx.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = $1 AND p.code = $2
           ON CONFLICT DO NOTHING`,
          [role, perm],
        );
        grants += res.rowCount ?? 0;
      }
    }
    return { rolesCreated, permissionsCreated, grants };
  }
}
