import request from 'supertest';
import { bearer, createRole, createTestApp, tokenFor, type TestContext } from '../helpers/app.js';

let ctx: TestContext;
let manager: { token: string; userId: string };
let admin: { token: string };
let clerk: { token: string };
beforeAll(async () => {
  ctx = await createTestApp();
  manager = await tokenFor(ctx, [await createRole(ctx.pool, ['settings:read','settings:manage'])]);
  admin = await tokenFor(ctx, ['SUPER_ADMIN']);
  clerk = await tokenFor(ctx, [await createRole(ctx.pool, ['settings:read'])]);
});
afterAll(() => ctx.close());

const get = async (key: string) => (await request(ctx.app).get(`/api/v1/settings/${key}`).set(bearer(manager.token))).body.data;

describe('settings', () => {
  it('lists all seeded settings and the unconfirmed ones', async () => {
    const all = await request(ctx.app).get('/api/v1/settings').set(bearer(clerk.token));
    expect(all.body.data.length).toBe(47);
    const unconfirmed = await request(ctx.app).get('/api/v1/settings/unconfirmed').set(bearer(clerk.token));
    expect(unconfirmed.body.data.every((s: { source: string }) => ['PROVISIONAL', 'UNSET'].includes(s.source))).toBe(true);
    const policy = all.body.data.find((s: { key: string }) => s.key === 'scale.unverifiedPolicy');
    expect(policy).toMatchObject({ value: 'BLOCK', options: ['BLOCK', 'WARN'], isSystem: false });
  });

  it('site manager changes a business key with reason; audited with before/after; becomes CONFIRMED', async () => {
    const s = await get('hopper.reconciliationTolerancePct');
    const res = await request(ctx.app).put('/api/v1/settings/hopper.reconciliationTolerancePct').set(bearer(manager.token))
      .send({ value: 1.5, version: s.version, reason: 'Agreed with QA on 2026-09-25' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ value: 1.5, source: 'CONFIRMED', version: s.version + 1, updatedById: manager.userId });
    const audit = await ctx.pool.query(
      `SELECT previous_value, new_value, user_id FROM audit_logs WHERE action = 'SETTING_CHANGE' AND new_value->>'key' = $1 ORDER BY id DESC LIMIT 1`,
      ['hopper.reconciliationTolerancePct'],
    );
    const row = audit.rows[0];
    expect(row.user_id).toBe(manager.userId);
    expect(row.previous_value).toMatchObject({ value: 0 });
    expect(row.new_value).toMatchObject({ value: 1.5, reason: 'Agreed with QA on 2026-09-25' });
  });

  it('rejects stale versions (optimistic lock)', async () => {
    const s = await get('ops.maxBackdateHours');
    const ok = await request(ctx.app).put('/api/v1/settings/ops.maxBackdateHours').set(bearer(manager.token)).send({ value: 12, version: s.version, reason: 'tighter' });
    expect(ok.status).toBe(200);
    const stale = await request(ctx.app).put('/api/v1/settings/ops.maxBackdateHours').set(bearer(manager.token)).send({ value: 6, version: s.version, reason: 'again' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_VERSION');
  });

  it('validates values against the registry', async () => {
    const s = await get('moisture.targetMaxPct');
    const bad = await request(ctx.app).put('/api/v1/settings/moisture.targetMaxPct').set(bearer(manager.token)).send({ value: 'high', version: s.version, reason: 'x y z' });
    expect(bad.status).toBe(400);
    const inverted = await request(ctx.app).put('/api/v1/settings/moisture.targetMaxPct').set(bearer(manager.token)).send({ value: 10, version: s.version, reason: 'below min' });
    expect(inverted.body.code).toBe('SETTING_RANGE_INVALID');
    const noReason = await request(ctx.app).put('/api/v1/settings/moisture.targetMaxPct').set(bearer(manager.token)).send({ value: 11.4, version: s.version });
    expect(noReason.status).toBe(400);
  });

  it('system keys need settings:manage-system (settings:manage alone cannot, SUPER_ADMIN can)', async () => {
    const s = await get('auth.maxFailedLogins');
    const sm = await request(ctx.app).put('/api/v1/settings/auth.maxFailedLogins').set(bearer(manager.token)).send({ value: 3, version: s.version, reason: 'harden' });
    expect(sm.status).toBe(403);
    const sa = await request(ctx.app).put('/api/v1/settings/auth.maxFailedLogins').set(bearer(admin.token)).send({ version: s.version, reason: 'confirm default' });
    expect(sa.status).toBe(200);
    expect(sa.body.data).toMatchObject({ value: 5, source: 'CONFIRMED' });
  });

  it('an UNSET setting cannot be merely confirmed', async () => {
    const s = await get('moisture.finalVerificationMaxAgeHours');
    expect(s.value).toBeNull();
    const res = await request(ctx.app).put('/api/v1/settings/moisture.finalVerificationMaxAgeHours').set(bearer(manager.token)).send({ version: s.version, reason: 'confirm' });
    expect(res.body.code).toBe('SETTING_VALUE_REQUIRED');
  });

  it('services report SETTING_NOT_CONFIGURED for required UNSET keys', async () => {
    await expect(ctx.c.settings.require(ctx.pool, 'defect.correctiveActionThresholdPct')).rejects.toMatchObject({ code: 'SETTING_NOT_CONFIGURED', statusCode: 422 });
  });

  it('settings:read alone can read but not change', async () => {
    const s = await get('scale.unverifiedPolicy');
    const res = await request(ctx.app).put('/api/v1/settings/scale.unverifiedPolicy').set(bearer(clerk.token)).send({ value: 'WARN', version: s.version, reason: 'faster' });
    expect(res.status).toBe(403);
  });
});
