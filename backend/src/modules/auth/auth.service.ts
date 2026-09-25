import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import type pg from 'pg';
import { AppError, BusinessRuleError, UnauthorizedError, ValidationError } from '../../common/errors.js';
import { parseDurationMs, randomToken, sha256Hex } from '../../common/util.js';
import type { AuditLogService } from '../../core/audit-log/audit-log.service.js';
import type { PasswordPolicy } from '../../core/settings/registry.js';
import type { SettingsService } from '../../core/settings/settings.service.js';
import { withTransaction } from '../../db/pool.js';
import type { AuthUser, RequestMeta } from '../../http/types.js';
import { checkPasswordPolicy, dummyPasswordHash, hashPassword, verifyPassword } from './password.js';

export interface SessionTokens {
  accessToken: string;
  accessTokenExpiresIn: number; // seconds
  refreshToken: string; // plaintext, only ever sent as an httpOnly cookie
  refreshTokenExpiresAt: Date;
}

export interface PrincipalView {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  mustChangePassword: boolean;
  roles: string[];
  permissions: string[];
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: AppError };

const PRINCIPAL_SQL = `
  SELECT u.id, u.username, u.full_name, u.email, u.status, u.must_change_password,
         COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
         COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
   WHERE u.id = $1
   GROUP BY u.id`;

/**
 * Authentication (ARCHITECTURE.md §14):
 * - short-lived HS256 access JWT (default 15 min), held in memory by the SPA
 * - opaque 256-bit refresh token, stored hashed, httpOnly cookie, rotated on
 *   every use with family reuse detection
 * - argon2id passwords, lockout after N failures, forced change on first login
 * Authorization data (status, roles, permissions) is read from the DB on every
 * request, so deactivation and permission changes apply immediately.
 */
export class AuthService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogService,
    private readonly jwtSecret: string,
    private readonly issuer: string,
  ) {}

  async loadPrincipal(db: pg.Pool | pg.PoolClient, userId: string): Promise<(AuthUser & { status: string; email: string | null }) | null> {
    const { rows } = await db.query(PRINCIPAL_SQL, [userId]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      username: r.username,
      fullName: r.full_name,
      email: r.email,
      status: r.status,
      mustChangePassword: r.must_change_password,
      roles: r.roles,
      permissions: new Set<string>(r.permissions),
    };
  }

  static view(p: AuthUser & { email?: string | null }): PrincipalView {
    return {
      id: p.id,
      username: p.username,
      fullName: p.fullName,
      email: p.email ?? null,
      mustChangePassword: p.mustChangePassword,
      roles: [...p.roles].sort(),
      permissions: [...p.permissions].sort(),
    };
  }

  /** Express-side authentication used by the route registry. */
  authenticate = async (req: Request): Promise<AuthUser> => {
    const header = req.get('authorization');
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedError();
    let sub: string;
    try {
      const payload = jwt.verify(header.slice(7), this.jwtSecret, { algorithms: ['HS256'], issuer: this.issuer }) as jwt.JwtPayload;
      if (typeof payload.sub !== 'string') throw new Error('no subject');
      sub = payload.sub;
    } catch (err) {
      const expired = err instanceof jwt.TokenExpiredError;
      throw new UnauthorizedError(expired ? 'Access token expired' : 'Invalid access token', expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN');
    }
    const principal = await this.loadPrincipal(this.pool, sub);
    if (!principal || principal.status !== 'ACTIVE') throw new UnauthorizedError('Account is not active', 'ACCOUNT_DISABLED');
    return principal;
  };

  private async issueTokens(tx: pg.PoolClient, user: { id: string; username: string; roles: string[] }, familyId: string, meta: RequestMeta): Promise<SessionTokens & { refreshId: string }> {
    const accessTtl = parseDurationMs(await this.settings.getIn<string>(tx, 'auth.accessTokenTtl'));
    const refreshTtl = parseDurationMs(await this.settings.getIn<string>(tx, 'auth.refreshTokenTtl'));
    const accessToken = jwt.sign({ username: user.username, roles: user.roles }, this.jwtSecret, {
      algorithm: 'HS256',
      subject: user.id,
      issuer: this.issuer,
      expiresIn: Math.floor(accessTtl / 1000),
      jwtid: randomUUID(),
    });
    const refreshToken = randomToken(32);
    const refreshTokenExpiresAt = new Date(Date.now() + refreshTtl);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [user.id, familyId, sha256Hex(refreshToken), refreshTokenExpiresAt, meta.ipAddress, meta.userAgent],
    );
    return { accessToken, accessTokenExpiresIn: Math.floor(accessTtl / 1000), refreshToken, refreshTokenExpiresAt, refreshId: rows[0]!.id };
  }

  private static unwrap<T>(o: Outcome<T>): T {
    if (!o.ok) throw o.error;
    return o.value;
  }

  async login(usernameRaw: string, password: string, meta: RequestMeta): Promise<{ tokens: SessionTokens; user: PrincipalView }> {
    const username = usernameRaw.trim().toLowerCase();
    const outcome = await withTransaction<Outcome<{ tokens: SessionTokens; user: PrincipalView }>>(this.pool, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, username, password_hash, status, failed_login_count, locked_until FROM users WHERE username = $1 FOR UPDATE`,
        [username],
      );
      const u = rows[0];
      const invalid = new UnauthorizedError('Invalid username or password', 'INVALID_CREDENTIALS');
      if (!u) {
        await verifyPassword(await dummyPasswordHash(), password);
        await this.audit.record(tx, { userId: null, action: 'LOGIN_FAILED', module: 'auth', entityType: 'User', newValue: { username, reason: 'UNKNOWN_USER' }, meta });
        return { ok: false, error: invalid };
      }
      const now = new Date();
      if (u.locked_until && u.locked_until > now) {
        await this.audit.record(tx, { userId: u.id, action: 'LOGIN_FAILED', module: 'auth', entityType: 'User', entityId: u.id, newValue: { reason: 'LOCKED' }, meta });
        return { ok: false, error: new UnauthorizedError('Account is temporarily locked after repeated failed logins', 'ACCOUNT_LOCKED') };
      }
      if (u.status === 'LOCKED' && (!u.locked_until || u.locked_until <= now)) {
        // lockout period elapsed
        await tx.query(`UPDATE users SET status = 'ACTIVE', failed_login_count = 0, locked_until = NULL WHERE id = $1`, [u.id]);
        u.status = 'ACTIVE';
        u.failed_login_count = 0;
      }
      const passwordOk = await verifyPassword(u.password_hash, password);
      if (u.status !== 'ACTIVE') {
        await this.audit.record(tx, { userId: u.id, action: 'LOGIN_FAILED', module: 'auth', entityType: 'User', entityId: u.id, newValue: { reason: u.status }, meta });
        return { ok: false, error: passwordOk ? new UnauthorizedError('Account is not active', 'ACCOUNT_DISABLED') : invalid };
      }
      if (!passwordOk) {
        const max = await this.settings.getIn<number>(tx, 'auth.maxFailedLogins');
        const lockMinutes = await this.settings.getIn<number>(tx, 'auth.lockoutMinutes');
        const failed = u.failed_login_count + 1;
        const lock = failed >= max;
        await tx.query(
          `UPDATE users SET failed_login_count = $2, status = $3, locked_until = $4 WHERE id = $1`,
          [u.id, lock ? 0 : failed, lock ? 'LOCKED' : 'ACTIVE', lock ? new Date(now.getTime() + lockMinutes * 60_000) : null],
        );
        await this.audit.record(tx, {
          userId: u.id, action: 'LOGIN_FAILED', module: 'auth', entityType: 'User', entityId: u.id,
          newValue: { reason: 'BAD_PASSWORD', failedCount: failed, locked: lock }, meta,
        });
        return { ok: false, error: lock ? new UnauthorizedError('Account is temporarily locked after repeated failed logins', 'ACCOUNT_LOCKED') : invalid };
      }
      await tx.query(`UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [u.id]);
      const principal = (await this.loadPrincipal(tx, u.id))!;
      const tokens = await this.issueTokens(tx, principal, randomUUID(), meta);
      await this.audit.record(tx, { userId: u.id, action: 'LOGIN', module: 'auth', entityType: 'User', entityId: u.id, meta });
      return { ok: true, value: { tokens, user: AuthService.view(principal) } };
    });
    return AuthService.unwrap(outcome);
  }

  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<{ tokens: SessionTokens; user: PrincipalView }> {
    if (!refreshToken) throw new UnauthorizedError('No refresh token', 'INVALID_REFRESH_TOKEN');
    const outcome = await withTransaction<Outcome<{ tokens: SessionTokens; user: PrincipalView }>>(this.pool, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, user_id, family_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [sha256Hex(refreshToken)],
      );
      const t = rows[0];
      if (!t) return { ok: false, error: new UnauthorizedError('Invalid refresh token', 'INVALID_REFRESH_TOKEN') };
      if (t.revoked_at) {
        // A rotated token was presented again: assume theft, kill the whole family.
        await tx.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [t.family_id]);
        await this.audit.record(tx, {
          userId: t.user_id, action: 'LOGOUT', module: 'auth', entityType: 'RefreshToken', entityId: t.id,
          newValue: { reason: 'REFRESH_TOKEN_REUSE', familyId: t.family_id }, meta,
        });
        return { ok: false, error: new UnauthorizedError('Session revoked, please sign in again', 'REFRESH_TOKEN_REUSED') };
      }
      if (t.expires_at <= new Date()) return { ok: false, error: new UnauthorizedError('Session expired', 'REFRESH_TOKEN_EXPIRED') };
      const principal = await this.loadPrincipal(tx, t.user_id);
      if (!principal || principal.status !== 'ACTIVE') {
        await tx.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [t.family_id]);
        return { ok: false, error: new UnauthorizedError('Account is not active', 'ACCOUNT_DISABLED') };
      }
      const tokens = await this.issueTokens(tx, principal, t.family_id, meta);
      await tx.query(`UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1`, [t.id, tokens.refreshId]);
      return { ok: true, value: { tokens, user: AuthService.view(principal) } };
    });
    return AuthService.unwrap(outcome);
  }

  async logout(refreshToken: string | undefined, meta: RequestMeta): Promise<void> {
    if (!refreshToken) return;
    await withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query(`SELECT id, user_id, family_id FROM refresh_tokens WHERE token_hash = $1`, [sha256Hex(refreshToken)]);
      const t = rows[0];
      if (!t) return;
      await tx.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [t.family_id]);
      await this.audit.record(tx, { userId: t.user_id, action: 'LOGOUT', module: 'auth', entityType: 'User', entityId: t.user_id, meta });
    });
  }

  async passwordPolicy(db: pg.Pool | pg.PoolClient = this.pool): Promise<PasswordPolicy> {
    return this.settings.getIn<PasswordPolicy>(db, 'auth.passwordPolicy');
  }

  async assertPasswordAcceptable(db: pg.Pool | pg.PoolClient, password: string, username: string): Promise<void> {
    const problems = checkPasswordPolicy(password, await this.passwordPolicy(db), { username });
    if (problems.length) {
      throw new ValidationError(problems.map((p) => ({ location: 'body', path: 'newPassword', message: `Password needs ${p}` })), 'Password does not meet the policy');
    }
  }

  /** Changes the caller's password, revokes every session and starts a fresh one. */
  async changePassword(user: AuthUser, currentPassword: string, newPassword: string, meta: RequestMeta): Promise<{ tokens: SessionTokens; user: PrincipalView }> {
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query(`SELECT password_hash FROM users WHERE id = $1 FOR UPDATE`, [user.id]);
      if (!rows[0] || !(await verifyPassword(rows[0].password_hash, currentPassword))) {
        throw new BusinessRuleError('CURRENT_PASSWORD_INCORRECT', 'The current password is incorrect');
      }
      if (currentPassword === newPassword) throw new BusinessRuleError('PASSWORD_UNCHANGED', 'The new password must be different');
      await this.assertPasswordAcceptable(tx, newPassword, user.username);
      await tx.query(`UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1`, [user.id, await hashPassword(newPassword)]);
      await tx.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [user.id]);
      await this.audit.record(tx, {
        userId: user.id, action: 'UPDATE', module: 'auth', entityType: 'User', entityId: user.id,
        newValue: { passwordChanged: true, sessionsRevoked: true }, meta,
      });
      const principal = (await this.loadPrincipal(tx, user.id))!;
      const tokens = await this.issueTokens(tx, principal, randomUUID(), meta);
      return { tokens, user: AuthService.view(principal) };
    });
  }

  /** Housekeeping job: delete refresh tokens that expired or were revoked more than 30 days ago. */
  async purgeExpiredTokens(): Promise<number> {
    const r = await this.pool.query(
      `DELETE FROM refresh_tokens WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days'`,
    );
    return r.rowCount ?? 0;
  }
}
