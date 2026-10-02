import request from 'supertest';
import { bearer, createTestApp, createUser, login, type TestContext } from '../helpers/app.js';
import { TEST_ADMIN_PASSWORD } from '../helpers/constants.js';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(() => ctx.close());

const cookieOf = (res: request.Response) => ((res.headers['set-cookie'] as unknown as string[]) ?? []).map((c) => c.split(';')[0]).join('; ');

describe('auth', () => {
  it('seeded admin must change password first; other endpoints return PASSWORD_CHANGE_REQUIRED', async () => {
    const { token, body } = await login(ctx.app, 'admin', TEST_ADMIN_PASSWORD);
    expect(body.data.user.mustChangePassword).toBe(true);
    expect(body.data.user.roles).toEqual(['SUPER_ADMIN']);
    const res = await request(ctx.app).get('/api/v1/users').set(bearer(token));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const me = await request(ctx.app).get('/api/v1/auth/me').set(bearer(token));
    expect(me.status).toBe(200);
    expect(me.body.data.permissions).toContain('user:manage');
  });

  it('sets an httpOnly refresh cookie scoped to /api/v1/auth', async () => {
    const u = await createUser(ctx.pool, ['SUPER_ADMIN']);
    const res = await request(ctx.app).post('/api/v1/auth/login').send({ username: u.username.toUpperCase(), password: u.password });
    expect(res.status).toBe(200);
    const raw = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(raw).toMatch(/^cws_rt=/);
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/Path=\/api\/v1\/auth/);
    expect(res.body.data.expiresIn).toBe(900);
  });

  it('rejects bad credentials with a generic error and audits LOGIN_FAILED', async () => {
    const u = await createUser(ctx.pool, []);
    const bad = await request(ctx.app).post('/api/v1/auth/login').send({ username: u.username, password: 'wrong-password-1' });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('INVALID_CREDENTIALS');
    const unknown = await request(ctx.app).post('/api/v1/auth/login').send({ username: 'no-such-user', password: 'x' });
    expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
    const a = await ctx.pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'LOGIN_FAILED' AND entity_id = $1`, [u.id]);
    expect(a.rows[0].n).toBe(1);
  });

  it('locks the account after auth.maxFailedLogins (5) failures, then unlocks after the lockout', async () => {
    const u = await createUser(ctx.pool, []);
    for (let i = 0; i < 4; i++) {
      const r = await request(ctx.app).post('/api/v1/auth/login').send({ username: u.username, password: 'wrong' });
      expect(r.body.code).toBe('INVALID_CREDENTIALS');
    }
    const fifth = await request(ctx.app).post('/api/v1/auth/login').send({ username: u.username, password: 'wrong' });
    expect(fifth.body.code).toBe('ACCOUNT_LOCKED');
    const correctWhileLocked = await request(ctx.app).post('/api/v1/auth/login').send({ username: u.username, password: u.password });
    expect(correctWhileLocked.body.code).toBe('ACCOUNT_LOCKED');
    const row = await ctx.pool.query('SELECT status FROM users WHERE id = $1', [u.id]);
    expect(row.rows[0].status).toBe('LOCKED');
    await ctx.pool.query(`UPDATE users SET locked_until = now() - interval '1 minute' WHERE id = $1`, [u.id]);
    const after = await request(ctx.app).post('/api/v1/auth/login').send({ username: u.username, password: u.password });
    expect(after.status).toBe(200);
  });

  it('change-password enforces the policy and clears the flag', async () => {
    const u = await createUser(ctx.pool, ['SUPER_ADMIN'], { mustChangePassword: true });
    const { token } = await login(ctx.app, u.username, u.password);
    const weak = await request(ctx.app).post('/api/v1/auth/change-password').set(bearer(token)).send({ currentPassword: u.password, newPassword: 'short' });
    expect(weak.status).toBe(400);
    const wrong = await request(ctx.app).post('/api/v1/auth/change-password').set(bearer(token)).send({ currentPassword: 'nope', newPassword: 'Brand-New-Pass-99' });
    expect(wrong.body.code).toBe('CURRENT_PASSWORD_INCORRECT');
    const ok = await request(ctx.app).post('/api/v1/auth/change-password').set(bearer(token)).send({ currentPassword: u.password, newPassword: 'Brand-New-Pass-99' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.user.mustChangePassword).toBe(false);
    const list = await request(ctx.app).get('/api/v1/users').set(bearer(ok.body.data.accessToken));
    expect(list.status).toBe(200);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const u = await createUser(ctx.pool, []);
    const first = await request(ctx.app).post('/api/v1/auth/login').send({ username: u.username, password: u.password });
    const c1 = cookieOf(first);
    const r1 = await request(ctx.app).post('/api/v1/auth/refresh').set('Cookie', c1);
    expect(r1.status).toBe(200);
    const c2 = cookieOf(r1);
    expect(c2).not.toBe(c1);
    // replaying the old token = theft signal
    const replay = await request(ctx.app).post('/api/v1/auth/refresh').set('Cookie', c1);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');
    // …which also killed the legitimate newer token
    const afterReuse = await request(ctx.app).post('/api/v1/auth/refresh').set('Cookie', c2);
    expect(afterReuse.status).toBe(401);
  });

  it('logout revokes the session', async () => {
    const u = await createUser(ctx.pool, []);
    const res = await request(ctx.app).post('/api/v1/auth/login').send({ username: u.username, password: u.password });
    const c = cookieOf(res);
    expect((await request(ctx.app).post('/api/v1/auth/logout').set('Cookie', c)).status).toBe(204);
    expect((await request(ctx.app).post('/api/v1/auth/refresh').set('Cookie', c)).status).toBe(401);
  });

  it('rejects missing, malformed and forged tokens', async () => {
    expect((await request(ctx.app).get('/api/v1/auth/me')).body.code).toBe('UNAUTHORIZED');
    expect((await request(ctx.app).get('/api/v1/auth/me').set(bearer('abc'))).body.code).toBe('INVALID_TOKEN');
    const { token } = await login(ctx.app, (await createUser(ctx.pool, [])).username, 'Password12345');
    const [h, p] = token.split('.');
    expect((await request(ctx.app).get('/api/v1/auth/me').set(bearer(`${h}.${p}.forged`))).status).toBe(401);
  });

  it('a deactivated user loses access immediately (permissions are read per request)', async () => {
    const u = await createUser(ctx.pool, ['SUPER_ADMIN']);
    const { token } = await login(ctx.app, u.username, u.password);
    expect((await request(ctx.app).get('/api/v1/users').set(bearer(token))).status).toBe(200);
    await ctx.pool.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [u.id]);
    const res = await request(ctx.app).get('/api/v1/users').set(bearer(token));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ACCOUNT_DISABLED');
  });

  it('uses the uniform error envelope', async () => {
    const res = await request(ctx.app).post('/api/v1/auth/login').send({ username: 'x' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ statusCode: 400, error: 'VALIDATION_ERROR', code: 'VALIDATION_ERROR', path: '/api/v1/auth/login' });
    expect(res.body.details[0]).toMatchObject({ location: 'body', path: 'password' });
    expect(res.body.requestId).toEqual(res.headers['x-request-id']);
    const nf = await request(ctx.app).get('/api/v1/nope');
    expect(nf.body.code).toBe('ROUTE_NOT_FOUND');
  });
});
