import request from 'supertest';
import { bearer, createRole, createTestApp, tokenFor, type TestContext } from '../helpers/app.js';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(() => ctx.close());

describe('audit log', () => {
  it('records actions with request metadata and filters them', async () => {
    const auditor = await tokenFor(ctx, [await createRole(ctx.pool, ['auditlog:read'])]); // login → LOGIN entry
    const res = await request(ctx.app)
      .get(`/api/v1/audit-logs?action=LOGIN&userId=${auditor.userId}`)
      .set(bearer(auditor.token));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({ action: 'LOGIN', module: 'auth', username: auditor.username });
    expect(res.body.data[0].requestId).toEqual(expect.any(String));
    expect(res.body.data[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writes the audit row in the same transaction as the change (rolled back together)', async () => {
    const before = (await ctx.pool.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n;
    const client = await ctx.pool.connect();
    try {
      await client.query('BEGIN');
      await ctx.c.audit.record(client, { userId: null, action: 'CREATE', module: 'test', entityType: 'Probe' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect((await ctx.pool.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n).toBe(before);
  });

  it('keeps a valid hash chain under concurrent writers', async () => {
    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        (async () => {
          const client = await ctx.pool.connect();
          try {
            await client.query('BEGIN');
            await ctx.c.audit.record(client, { userId: null, action: 'CREATE', module: 'test', entityType: 'Concurrent', entityId: String(i), newValue: { i } });
            await client.query('COMMIT');
          } finally {
            client.release();
          }
        })(),
      ),
    );
    const auditor = await tokenFor(ctx, [await createRole(ctx.pool, ['auditlog:read'])]);
    const res = await request(ctx.app).get('/api/v1/audit-logs/verify').set(bearer(auditor.token));
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.checked).toBeGreaterThan(15);
  });

  it('detects tampering (even by a DB owner who bypasses the append-only trigger)', async () => {
    const { rows } = await ctx.pool.query(`SELECT id, module FROM audit_logs ORDER BY id LIMIT 1 OFFSET 1`);
    const client = await ctx.pool.connect();
    try {
      await client.query('ALTER TABLE audit_logs DISABLE TRIGGER t_audit_logs_append_only');
      await client.query(`UPDATE audit_logs SET module = 'tampered' WHERE id = $1`, [rows[0].id]);
      const result = await ctx.c.audit.verify(ctx.pool);
      expect(result).toMatchObject({ valid: false, brokenAtId: String(rows[0].id), reason: 'hash mismatch' });
      await client.query(`UPDATE audit_logs SET module = $2 WHERE id = $1`, [rows[0].id, rows[0].module]);
    } finally {
      await client.query('ALTER TABLE audit_logs ENABLE TRIGGER t_audit_logs_append_only');
      client.release();
    }
    expect((await ctx.c.audit.verify(ctx.pool)).valid).toBe(true);
  });

  it('is readable only with auditlog:read', async () => {
    const clerk = await tokenFor(ctx, [await createRole(ctx.pool, ['settings:read'])]);
    expect((await request(ctx.app).get('/api/v1/audit-logs').set(bearer(clerk.token))).status).toBe(403);
  });
});
