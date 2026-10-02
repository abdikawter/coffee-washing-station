import request from 'supertest';
import { bearer, createRole, createTestApp, login, tokenFor, uniqueName, type TestContext } from '../helpers/app.js';

let ctx: TestContext;
let admin: { token: string; userId: string };
beforeAll(async () => {
  ctx = await createTestApp();
  admin = await tokenFor(ctx, ['SUPER_ADMIN']);
});
afterAll(() => ctx.close());

const api = () => request(ctx.app);

describe('users & roles', () => {
  it('creates a user who must change the temporary password; audit hides the hash', async () => {
    const username = uniqueName('admin');
    const res = await api().post('/api/v1/users').set(bearer(admin.token)).send({
      username, fullName: 'Almaz Admin', roleCodes: ['SUPER_ADMIN'], temporaryPassword: 'TempPass12345', phone: '0911000000',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ username, roles: ['SUPER_ADMIN'], mustChangePassword: true, status: 'ACTIVE' });
    expect(res.body.data).not.toHaveProperty('passwordHash');
    const { body } = await login(ctx.app, username, 'TempPass12345');
    expect(body.data.user.permissions).toContain('purchase:create');
    const a = await ctx.pool.query(`SELECT new_value FROM audit_logs WHERE entity_id = $1 AND action = 'CREATE'`, [res.body.data.id]);
    expect(JSON.stringify(a.rows[0].new_value)).not.toMatch(/\$argon2/);
  });

  it('rejects duplicate usernames, unknown roles and weak passwords', async () => {
    const username = uniqueName('dup');
    const body = { username, fullName: 'Dup User', roleCodes: ['SUPER_ADMIN'], temporaryPassword: 'TempPass12345' };
    expect((await api().post('/api/v1/users').set(bearer(admin.token)).send(body)).status).toBe(201);
    const dup = await api().post('/api/v1/users').set(bearer(admin.token)).send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE');
    expect((await api().post('/api/v1/users').set(bearer(admin.token)).send({ ...body, username: uniqueName(), roleCodes: ['KING'] })).status).toBe(400);
    expect((await api().post('/api/v1/users').set(bearer(admin.token)).send({ ...body, username: uniqueName(), temporaryPassword: 'abc' })).status).toBe(400);
    expect((await api().post('/api/v1/users').set(bearer(admin.token)).send({ ...body, username: uniqueName(), extra: 1 })).status).toBe(400);
  });

  it('lists with filters and pagination', async () => {
    const res = await api().get('/api/v1/users?role=SUPER_ADMIN&pageSize=2&sort=-createdAt').set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 2 });
    expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
    for (const u of res.body.data) expect(u.roles).toContain('SUPER_ADMIN');
    expect((await api().get('/api/v1/users?sort=password').set(bearer(admin.token))).status).toBe(400);
  });

  it('replaces roles with a reason; permission change applies to existing tokens at once', async () => {
    const reader = await createRole(ctx.pool, ['auditlog:read']);
    const other = await createRole(ctx.pool, ['settings:read']);
    const target = await tokenFor(ctx, [reader]);
    expect((await api().get('/api/v1/audit-logs').set(bearer(target.token))).status).toBe(200);
    const res = await api().put(`/api/v1/users/${target.userId}/roles`).set(bearer(admin.token)).send({ roleCodes: [other], reason: 'moved to store' });
    expect(res.status).toBe(200);
    expect(res.body.data.roles).toEqual([other]);
    expect((await api().get('/api/v1/audit-logs').set(bearer(target.token))).status).toBe(403);
  });

  it('never leaves the system without an active SUPER_ADMIN and forbids self-deactivation', async () => {
    const self = await api().post(`/api/v1/users/${admin.userId}/deactivate`).set(bearer(admin.token)).send({ reason: 'test' });
    expect(self.body.code).toBe('SELF_DEACTIVATION');
    // deactivate every other super admin, then try to remove the last one's role
    const others = await ctx.pool.query(
      `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
        WHERE r.code = 'SUPER_ADMIN' AND u.id <> $1`, [admin.userId]);
    const second = await tokenFor(ctx, ['SUPER_ADMIN']);
    for (const o of others.rows) await ctx.pool.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [o.id]);
    await ctx.pool.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [second.userId]);
    const res = await api().put(`/api/v1/users/${admin.userId}/roles`).set(bearer(admin.token)).send({ roleCodes: [await createRole(ctx.pool, ['settings:read'])], reason: 'oops' });
    expect(res.body.code).toBe('LAST_SUPER_ADMIN');
    for (const o of others.rows) await ctx.pool.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [o.id]);
  });

  it('deactivate / activate / reset-password flow', async () => {
    const t = await tokenFor(ctx, [await createRole(ctx.pool, ['settings:read'])]);
    const d = await api().post(`/api/v1/users/${t.userId}/deactivate`).set(bearer(admin.token)).send({ reason: 'left the station' });
    expect(d.body.data.status).toBe('INACTIVE');
    expect((await api().get('/api/v1/auth/me').set(bearer(t.token))).status).toBe(401);
    const a = await api().post(`/api/v1/users/${t.userId}/activate`).set(bearer(admin.token)).send({ reason: 'returned' });
    expect(a.body.data.status).toBe('ACTIVE');
    const r = await api().post(`/api/v1/users/${t.userId}/reset-password`).set(bearer(admin.token)).send({ temporaryPassword: 'Reset-Pass-123', reason: 'forgot' });
    expect(r.body.data.mustChangePassword).toBe(true);
    const unlock = await api().post(`/api/v1/users/${t.userId}/unlock`).set(bearer(admin.token)).send({ reason: 'check lock' });
    expect(unlock.body.code).toBe('USER_NOT_LOCKED');
  });

  it('lists roles/permissions and edits role permissions (with SUPER_ADMIN lockout guard)', async () => {
    const roles = await api().get('/api/v1/roles').set(bearer(admin.token));
    // the catalog seeds one system role, SUPER_ADMIN, holding every permission
    const system = roles.body.data.filter((r: { isSystem: boolean }) => r.isSystem);
    expect(system.map((r: { code: string }) => r.code)).toEqual(['SUPER_ADMIN']);
    const sa = system[0];
    const perms = await api().get('/api/v1/permissions').set(bearer(admin.token));
    expect(perms.body.data.length).toBeGreaterThan(100);
    expect(sa.permissions).toHaveLength(perms.body.data.length);
    const bad = await api().put(`/api/v1/roles/${sa.id}/permissions`).set(bearer(admin.token)).send({ permissionCodes: ['user:read'], reason: 'test' });
    expect(bad.body.code).toBe('SUPER_ADMIN_LOCKOUT');
    const code = await createRole(ctx.pool, ['drying:read']);
    const custom = (await api().get('/api/v1/roles').set(bearer(admin.token))).body.data.find((r: { code: string }) => r.code === code);
    const upd = await api().put(`/api/v1/roles/${custom.id}/permissions`).set(bearer(admin.token)).send({ permissionCodes: ['drying:read', 'lot:read'], reason: 'extend' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.permissions).toEqual(['drying:read', 'lot:read']);
  });

  it('manages employees', async () => {
    const no = uniqueName('EMP');
    const c = await api().post('/api/v1/employees').set(bearer(admin.token)).send({ employeeNo: no, fullName: 'Kebede Tesfaye', position: 'Mechanic', department: 'MAINTENANCE' });
    expect(c.status).toBe(201);
    const u = await api().patch(`/api/v1/employees/${c.body.data.id}`).set(bearer(admin.token)).send({ position: 'Senior Mechanic' });
    expect(u.body.data).toMatchObject({ position: 'Senior Mechanic', phone: null, department: 'MAINTENANCE' });
    const l = await api().get(`/api/v1/employees?search=${no}`).set(bearer(admin.token));
    expect(l.body.meta.total).toBe(1);
  });
});
