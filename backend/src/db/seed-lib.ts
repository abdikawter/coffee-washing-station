import type pg from 'pg';
import { AuditLogService } from '../core/audit-log/audit-log.service.js';
import { SettingsService } from '../core/settings/settings.service.js';
import { RolesService } from '../modules/access/roles.service.js';
import { checkPasswordPolicy, hashPassword } from '../modules/auth/password.js';
import { SETTINGS_BY_KEY, type PasswordPolicy } from '../core/settings/registry.js';
import { withTransaction } from './pool.js';

export interface SeedResult {
  rolesCreated: number;
  permissionsCreated: number;
  grants: number;
  settingsCreated: number;
  adminCreated: boolean;
}

/**
 * Idempotent seed: roles + permissions (catalog), settings (registry), and the
 * first SUPER_ADMIN when none exists. Safe to run on every deploy.
 */
export async function seed(pool: pg.Pool, admin: { username: string; fullName: string; password?: string }): Promise<SeedResult> {
  const audit = new AuditLogService();
  const settings = new SettingsService(pool, audit);
  return withTransaction(pool, async (tx) => {
    const catalog = await RolesService.seedCatalog(tx);
    const settingsCreated = await settings.seedDefaults(tx);

    const { rows } = await tx.query(
      `SELECT count(*)::int AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.code = 'SUPER_ADMIN'`,
    );
    let adminCreated = false;
    if (rows[0].n === 0) {
      if (!admin.password) {
        throw new Error('No SUPER_ADMIN exists yet: set SEED_ADMIN_PASSWORD (temporary; must be changed at first login).');
      }
      const policy = SETTINGS_BY_KEY.get('auth.passwordPolicy')!.defaultValue as PasswordPolicy;
      const problems = checkPasswordPolicy(admin.password, policy, { username: admin.username });
      if (problems.length) throw new Error(`SEED_ADMIN_PASSWORD needs: ${problems.join(', ')}`);
      const username = admin.username.trim().toLowerCase();
      const ins = await tx.query(
        `INSERT INTO users (username, full_name, password_hash, must_change_password) VALUES ($1, $2, $3, true)
         ON CONFLICT (username) DO UPDATE SET must_change_password = true RETURNING id`,
        [username, admin.fullName, await hashPassword(admin.password)],
      );
      const userId = ins.rows[0].id as string;
      await tx.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'SUPER_ADMIN' ON CONFLICT DO NOTHING`, [userId]);
      await audit.record(tx, {
        userId: null, action: 'CREATE', module: 'users', entityType: 'User', entityId: userId,
        newValue: { username, roles: ['SUPER_ADMIN'], source: 'seed' },
      });
      adminCreated = true;
    }
    return { ...catalog, settingsCreated, adminCreated };
  });
}
