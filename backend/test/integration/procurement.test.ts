/**
 * Phase 2 exit gate: supplier → inspection → scale check → voucher → verify →
 * approve → pay → lot, plus concurrency, scale policy, holds, reversal and void.
 * Every actor is a SUPER_ADMIN (the only role for now); "readOnly" holds the
 * *:read permissions only and checks that commands are refused without permission.
 */
import request from 'supertest';
import { bearer, createRole, createTestApp, tokenFor, uniqueName, type TestContext } from '../helpers/app.js';

let ctx: TestContext;
type Tok = { token: string; userId: string };
let admin: Tok, manager: Tok, inspector: Tok, clerk: Tok, cashier: Tok, readOnly: Tok;
let coffeeTypeId: string;
let scaleId: string;

const api = () => request(ctx.app);
const setSetting = (key: string, value: unknown) =>
  ctx.pool.query('UPDATE system_settings SET value = $2 WHERE key = $1', [key, JSON.stringify(value)]);

async function newSupplier(): Promise<string> {
  const res = await api().post('/api/v1/suppliers').set(bearer(clerk.token)).send({ supplierCode: uniqueName('F'), fullName: 'Almaz Tesfaye', phone: '+251911000000', village: 'Yirgacheffe' });
  expect(res.status).toBe(201);
  return res.body.data.id;
}

async function inspection(supplierId: string, by: Tok = inspector, pct = { redRipePct: '85', greenUnripePct: '10', overripeDamagedPct: '5' }) {
  const res = await api().post('/api/v1/quality/inspections').set(bearer(by.token)).send({ supplierId, ...pct, decision: 'ACCEPTED' });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function newScale(verify = true): Promise<string> {
  const res = await api().post('/api/v1/scales').set(bearer(admin.token)).send({ code: uniqueName('SC'), name: 'Platform scale', capacityKg: '500' });
  expect(res.status).toBe(201);
  if (verify) {
    const v = await api().post(`/api/v1/scales/${res.body.data.id}/calibrations`).set(bearer(inspector.token))
      .send({ standardWeightKg: '20', readingKg: '20.02', result: 'PASS' });
    expect(v.status).toBe(201);
  }
  return res.body.data.id;
}

function voucherBody(inspectionId: string, scale = scaleId) {
  return {
    qualityInspectionId: inspectionId, coffeeTypeId, pricePerKg: '45.10',
    items: [{ weighings: [{ scaleId: scale, grossKg: '50.100', tareKg: '0.500' }, { scaleId: scale, grossKg: '40.200', tareKg: '0.500' }] }],
  };
}

async function command(path: string, by: Tok, body: object = {}) {
  return api().post(`/api/v1${path}`).set(bearer(by.token)).send(body);
}

/** Creates a voucher as `creator` and drives it to APPROVED with the standard actors. */
async function approvedVoucher(creator: Tok = clerk): Promise<{ id: string; version: number; totalAmount: string }> {
  const insp = await inspection(await newSupplier());
  let v = (await api().post('/api/v1/purchases').set(bearer(creator.token)).send(voucherBody(insp.id))).body.data;
  v = (await command(`/purchases/${v.id}/submit`, creator, { version: v.version })).body.data;
  v = (await command(`/purchases/${v.id}/verify`, inspector, { version: v.version })).body.data;
  const res = await command(`/purchases/${v.id}/approve`, manager, { version: v.version });
  expect(res.status).toBe(200);
  return res.body.data;
}

beforeAll(async () => {
  ctx = await createTestApp();
  [admin, manager, inspector, clerk, cashier] = await Promise.all(
    [1, 2, 3, 4, 5].map(() => tokenFor(ctx, ['SUPER_ADMIN'])),
  ) as unknown as [Tok, Tok, Tok, Tok, Tok];
  const { rows: readPerms } = await ctx.pool.query(`SELECT code FROM permissions WHERE code LIKE '%:read'`);
  readOnly = await tokenFor(ctx, [await createRole(ctx.pool, readPerms.map((r) => r.code))]);
  const types = await api().get('/api/v1/coffee-types').set(bearer(clerk.token));
  coffeeTypeId = types.body.data.find((t: { code: string }) => t.code === 'RED_CHERRY').id;
  scaleId = await newScale();
}, 60_000);
afterAll(() => ctx.close());

describe('procurement end to end', () => {
  it('supplier → inspection → verified scale → voucher → verify → approve → pay → lot + PURCHASED event', async () => {
    const supplierId = await newSupplier();
    const insp = await inspection(supplierId);
    expect(insp).toMatchObject({ decision: 'ACCEPTED', inspectionNo: expect.stringMatching(/^QI-\d{4}-\d{6}$/) });

    const created = await api().post('/api/v1/purchases').set(bearer(clerk.token)).send(voucherBody(insp.id));
    expect(created.status).toBe(201);
    let v = created.body.data;
    expect(v).toMatchObject({
      status: 'DRAFT', voucherNo: expect.stringMatching(/^PV-\d{4}-\d{6}$/), totalWeightKg: '89.300', totalAmount: '4027.43',
      weighingClerkId: clerk.userId, qualityInspectorId: inspector.userId, scaleWarning: null,
    });
    expect(v.items[0].weighings.map((w: { netKg: string; scaleVerified: boolean }) => [w.netKg, w.scaleVerified])).toEqual([['49.600', true], ['39.700', true]]);

    v = (await command(`/purchases/${v.id}/submit`, clerk, { version: v.version })).body.data;
    expect(v.status).toBe('PENDING_VERIFICATION');
    const noPermission = await command(`/purchases/${v.id}/verify`, readOnly, { version: v.version });
    expect(noPermission.body.code).toBe('FORBIDDEN');
    v = (await command(`/purchases/${v.id}/verify`, inspector, { version: v.version })).body.data;
    expect(v).toMatchObject({ status: 'VERIFIED', verifiedById: inspector.userId });
    const stale = await command(`/purchases/${v.id}/approve`, manager, { version: v.version - 1 });
    expect(stale.body.code).toBe('STALE_VERSION');
    v = (await command(`/purchases/${v.id}/approve`, manager, { version: v.version })).body.data;
    expect(v).toMatchObject({ status: 'APPROVED', approvedById: manager.userId, lot: null }); // lot created on payment (default)

    const early = await api().post('/api/v1/payments').set(bearer(cashier.token)).send({ voucherId: (await approvedVoucher()).id, method: 'CASH' });
    expect(early.status).toBe(201);

    let p = (await api().post('/api/v1/payments').set(bearer(cashier.token)).send({ voucherId: v.id, method: 'CASH' })).body.data;
    expect(p).toMatchObject({ status: 'PENDING_APPROVAL', amount: '4027.43', paymentNo: expect.stringMatching(/^PAY-/) });
    const disburseEarly = await command(`/payments/${p.id}/disburse`, cashier);
    expect(disburseEarly.body.code).toBe('INVALID_STATUS_TRANSITION');
    p = (await command(`/payments/${p.id}/approve`, manager)).body.data;
    expect(p.status).toBe('APPROVED');
    p = (await command(`/payments/${p.id}/disburse`, cashier)).body.data;
    expect(p).toMatchObject({ status: 'PAID', cashierId: cashier.userId });

    const paid = (await api().get(`/api/v1/purchases/${v.id}`).set(bearer(clerk.token))).body.data;
    expect(paid).toMatchObject({ status: 'PAID', cashierId: cashier.userId, lot: { lotNumber: expect.stringMatching(/^LOT-\d{6}-\d{4}$/), currentStage: 'PURCHASED', status: 'ACTIVE' } });
    const lot = await ctx.pool.query('SELECT * FROM lots WHERE purchase_voucher_id = $1', [v.id]);
    expect(lot.rows[0]).toMatchObject({ type: 'PURCHASE', supplier_id: supplierId, original_cherry_weight_kg: '89.300', current_weight_kg: '89.300' });
    const events = await ctx.pool.query('SELECT sequence, event_type, stage, quantity_kg, ref_type, ref_id FROM lot_events WHERE lot_id = $1', [lot.rows[0].id]);
    expect(events.rows).toEqual([{ sequence: 1, event_type: 'PURCHASED', stage: 'PURCHASED', quantity_kg: '89.300', ref_type: 'PurchaseVoucher', ref_id: v.id }]);
    const cash = await ctx.pool.query('SELECT direction, type, amount FROM cash_transactions WHERE payment_id = $1', [p.id]);
    expect(cash.rows).toEqual([{ direction: 'OUT', type: 'SUPPLIER_PAYMENT', amount: '4027.43' }]);

    const pdf = await api().get(`/api/v1/purchases/${v.id}/pdf`).set(bearer(clerk.token)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const history = (await api().get(`/api/v1/suppliers/${supplierId}/history`).set(bearer(clerk.token))).body.data;
    expect(history.totals).toMatchObject({ vouchers: 1, purchasedKg: '89.300', paidAmount: '4027.43' });
    expect(history.payments).toHaveLength(1);
  });

  it('reverse payment → mirror cash entry and voucher back to APPROVED; then void closes the lot', async () => {
    const v = await approvedVoucher();
    let p = (await api().post('/api/v1/payments').set(bearer(cashier.token)).send({ voucherId: v.id, method: 'MOBILE_MONEY', referenceNo: 'MM-1' })).body.data;
    await command(`/payments/${p.id}/approve`, manager);
    await command(`/payments/${p.id}/disburse`, cashier);
    expect((await command(`/payments/${p.id}/reverse`, manager, {})).status).toBe(400); // reason required
    const noPermission = await command(`/payments/${p.id}/reverse`, readOnly, { reason: 'wrong supplier' });
    expect(noPermission.body.code).toBe('FORBIDDEN');
    p = (await command(`/payments/${p.id}/reverse`, manager, { reason: 'Paid the wrong farmer' })).body.data;
    expect(p).toMatchObject({ status: 'REVERSED', reversalReason: 'Paid the wrong farmer' });
    const cash = await ctx.pool.query('SELECT direction, type, amount, reversal_of_id FROM cash_transactions WHERE payment_id = $1 ORDER BY created_at', [p.id]);
    expect(cash.rows.map((r) => [r.direction, r.type])).toEqual([['OUT', 'SUPPLIER_PAYMENT'], ['IN', 'REVERSAL']]);
    expect(cash.rows[1].reversal_of_id).not.toBeNull();

    let voucher = (await api().get(`/api/v1/purchases/${v.id}`).set(bearer(manager.token))).body.data;
    expect(voucher).toMatchObject({ status: 'APPROVED', cashierId: null });
    expect((await command(`/purchases/${v.id}/void`, manager, { version: voucher.version })).status).toBe(400);
    voucher = (await command(`/purchases/${v.id}/void`, manager, { version: voucher.version, reason: 'Duplicate purchase' })).body.data;
    expect(voucher).toMatchObject({ status: 'VOIDED', cancelReason: 'Duplicate purchase', lot: { status: 'CLOSED' } });
  });

  it('cannot void while a payment is live; cancel and return need a reason', async () => {
    const v = await approvedVoucher();
    await api().post('/api/v1/payments').set(bearer(cashier.token)).send({ voucherId: v.id, method: 'CASH' });
    const res = await command(`/purchases/${v.id}/void`, manager, { version: v.version, reason: 'try' });
    expect(res.body.code).toBe('VOUCHER_HAS_LIVE_PAYMENT');

    const insp = await inspection(await newSupplier());
    let d = (await api().post('/api/v1/purchases').set(bearer(clerk.token)).send(voucherBody(insp.id))).body.data;
    d = (await command(`/purchases/${d.id}/submit`, clerk, { version: d.version })).body.data;
    d = (await command(`/purchases/${d.id}/return`, inspector, { version: d.version, reason: 'Tare looks wrong' })).body.data;
    expect(d).toMatchObject({ status: 'DRAFT', submittedAt: null });
    const edited = await api().put(`/api/v1/purchases/${d.id}`).set(bearer(clerk.token))
      .send({ ...voucherBody(insp.id), pricePerKg: '50', version: d.version });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ totalAmount: '4465.00', version: d.version + 1 });
    const cancelled = await command(`/purchases/${d.id}/cancel`, clerk, { version: edited.body.data.version, reason: 'Farmer left' });
    expect(cancelled.body.data.status).toBe('CANCELLED');
    const again = await command(`/purchases/${d.id}/submit`, clerk, { version: cancelled.body.data.version });
    expect(again.body.code).toBe('INVALID_STATUS_TRANSITION');
  });
});

describe('single super admin (no segregation of duties)', () => {
  it('one person can create, verify, approve, pay and reverse the same voucher', async () => {
    const insp = await inspection(await newSupplier(), admin);
    let v = (await api().post('/api/v1/purchases').set(bearer(admin.token)).send(voucherBody(insp.id))).body.data;
    for (const cmd of ['submit', 'verify', 'approve'] as const) {
      const res = await command(`/purchases/${v.id}/${cmd}`, admin, { version: v.version });
      expect(res.status).toBe(200);
      v = res.body.data;
    }
    expect(v).toMatchObject({ status: 'APPROVED', createdById: admin.userId, weighingClerkId: admin.userId, verifiedById: admin.userId, approvedById: admin.userId });
    let p = (await api().post('/api/v1/payments').set(bearer(admin.token)).send({ voucherId: v.id, method: 'CASH' })).body.data;
    p = (await command(`/payments/${p.id}/approve`, admin)).body.data;
    p = (await command(`/payments/${p.id}/disburse`, admin)).body.data;
    expect(p).toMatchObject({ status: 'PAID', cashierId: admin.userId, approvedById: admin.userId });
    const paid = (await api().get(`/api/v1/purchases/${v.id}`).set(bearer(admin.token))).body.data;
    expect(paid).toMatchObject({ status: 'PAID', cashierId: admin.userId, lot: { currentStage: 'PURCHASED' } });
    expect((await command(`/payments/${p.id}/reverse`, admin, { reason: 'Test reversal' })).body.data.status).toBe('REVERSED');
  });
});

describe('payments', () => {
  it('two parallel payments for one voucher → exactly one succeeds', async () => {
    const v = await approvedVoucher();
    const results = await Promise.all([0, 1, 2].map(() => api().post('/api/v1/payments').set(bearer(cashier.token)).send({ voucherId: v.id, method: 'CASH' })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 201).every((r) => ['PAYMENT_ALREADY_EXISTS', 'DUPLICATE'].includes(r.body.code))).toBe(true);
    const n = await ctx.pool.query('SELECT count(*)::int AS n FROM supplier_payments WHERE voucher_id = $1', [v.id]);
    expect(n.rows[0].n).toBe(1);
  });

  it('refuses payment before approval and replays idempotent requests', async () => {
    const insp = await inspection(await newSupplier());
    const draft = (await api().post('/api/v1/purchases').set(bearer(clerk.token)).send(voucherBody(insp.id))).body.data;
    const early = await api().post('/api/v1/payments').set(bearer(cashier.token)).send({ voucherId: draft.id, method: 'CASH' });
    expect(early.body).toMatchObject({ statusCode: 422, code: 'PAYMENT_BEFORE_APPROVAL', details: { voucherStatus: 'DRAFT' } });

    const v = await approvedVoucher();
    const key = `pay-${uniqueName()}`;
    const first = await api().post('/api/v1/payments').set(bearer(cashier.token)).set('Idempotency-Key', key).send({ voucherId: v.id, method: 'CASH' });
    const replay = await api().post('/api/v1/payments').set(bearer(cashier.token)).set('Idempotency-Key', key).send({ voucherId: v.id, method: 'CASH' });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.data.id).toBe(first.body.data.id);
  });

  it('non-cash payments need a reference; without approval step payments start APPROVED', async () => {
    const v = await approvedVoucher();
    expect((await api().post('/api/v1/payments').set(bearer(cashier.token)).send({ voucherId: v.id, method: 'BANK_TRANSFER' })).status).toBe(400);
    await setSetting('payment.requiresApproval', false);
    try {
      const p = await api().post('/api/v1/payments').set(bearer(cashier.token)).send({ voucherId: v.id, method: 'BANK_TRANSFER', referenceNo: 'TRX-9' });
      expect(p.body.data).toMatchObject({ status: 'APPROVED', approvedById: null });
      expect((await command(`/payments/${p.body.data.id}/disburse`, cashier)).body.data.status).toBe('PAID');
    } finally {
      await setSetting('payment.requiresApproval', true);
    }
  });

  it('creates the lot at approval when purchase.lotCreationTrigger = ON_APPROVAL', async () => {
    await setSetting('purchase.lotCreationTrigger', 'ON_APPROVAL');
    try {
      const v = await approvedVoucher();
      expect((v as unknown as { lot: { currentStage: string } }).lot).toMatchObject({ currentStage: 'PURCHASED' });
    } finally {
      await setSetting('purchase.lotCreationTrigger', 'ON_PAYMENT');
    }
  });
});

describe('scales and weighing policy', () => {
  it('BLOCK: weighing on an unverified scale → 422; WARN: allowed and flagged', async () => {
    const fresh = await newScale(false);
    const insp = await inspection(await newSupplier());
    const blocked = await api().post('/api/v1/purchases').set(bearer(clerk.token)).send(voucherBody(insp.id, fresh));
    expect(blocked.body).toMatchObject({ code: 'SCALE_NOT_VERIFIED', details: { reason: 'NEVER_VERIFIED', policy: 'BLOCK' } });

    await setSetting('scale.unverifiedPolicy', 'WARN');
    try {
      const warned = await api().post('/api/v1/purchases').set(bearer(clerk.token)).send(voucherBody(insp.id, fresh));
      expect(warned.status).toBe(201);
      expect(warned.body.data.scaleWarning).toMatch(/not verified \(NEVER_VERIFIED\)/);
      expect(warned.body.data.items[0].weighings.every((w: { scaleVerified: boolean }) => !w.scaleVerified)).toBe(true);
      const event = await ctx.pool.query(`SELECT 1 FROM outbox_events WHERE event_type = 'purchase.unverified-scale' AND aggregate_id = $1`, [warned.body.data.id]);
      expect(event.rowCount).toBe(1);
    } finally {
      await setSetting('scale.unverifiedPolicy', 'BLOCK');
    }
  });

  it('a failed verification takes the scale out of service and raises a FAILED_CALIBRATION corrective action', async () => {
    const s = await newScale();
    await setSetting('scale.verificationToleranceKg', 0.05);
    try {
      const fail = await api().post(`/api/v1/scales/${s}/calibrations`).set(bearer(clerk.token)).send({ standardWeightKg: '20', readingKg: '20.4', result: 'PASS' });
      expect(fail.status).toBe(201);
      expect(fail.body.data).toMatchObject({ result: 'FAIL', resultSource: 'TOLERANCE', deviationKg: '0.400', toleranceKg: 0.05, scale: { status: 'OUT_OF_SERVICE' } });
      const ca = await ctx.pool.query('SELECT source, is_auto_generated, status FROM corrective_actions WHERE id = $1', [fail.body.data.correctiveAction.id]);
      expect(ca.rows[0]).toEqual({ source: 'FAILED_CALIBRATION', is_auto_generated: true, status: 'OPEN' });

      await setSetting('scale.unverifiedPolicy', 'WARN');
      const insp = await inspection(await newSupplier());
      const blocked = await api().post('/api/v1/purchases').set(bearer(clerk.token)).send(voucherBody(insp.id, s));
      expect(blocked.body).toMatchObject({ code: 'SCALE_NOT_VERIFIED', details: { reason: 'OUT_OF_SERVICE' } }); // even under WARN
      await setSetting('scale.unverifiedPolicy', 'BLOCK');

      const pass = await api().post(`/api/v1/scales/${s}/calibrations`).set(bearer(inspector.token)).send({ standardWeightKg: '20', readingKg: '20.03' });
      expect(pass.body.data).toMatchObject({ result: 'PASS', scale: { status: 'OPERATIONAL', verification: { verified: true } } });
      const hist = await api().get(`/api/v1/scales/${s}/calibrations`).set(bearer(manager.token));
      expect(hist.body.data.map((c: { result: string }) => c.result)).toEqual(['PASS', 'FAIL', 'PASS']); // newest first; newScale() recorded the first PASS
    } finally {
      await setSetting('scale.verificationToleranceKg', null);
      await setSetting('scale.unverifiedPolicy', 'BLOCK');
    }
  });

  it('without a tolerance the verifier must state the result; weighings above capacity are refused', async () => {
    const res = await api().post(`/api/v1/scales/${scaleId}/calibrations`).set(bearer(inspector.token)).send({ standardWeightKg: '20', readingKg: '20' });
    expect(res.body.code).toBe('CALIBRATION_RESULT_REQUIRED');
    const insp = await inspection(await newSupplier());
    const over = await api().post('/api/v1/purchases').set(bearer(clerk.token))
      .send({ ...voucherBody(insp.id), items: [{ weighings: [{ scaleId, grossKg: '600' }] }] });
    expect(over.body.code).toBe('SCALE_CAPACITY_EXCEEDED');
  });
});

describe('quality', () => {
  it('rejects bad percentage sums, inactive suppliers and reused inspections', async () => {
    const supplierId = await newSupplier();
    const bad = await api().post('/api/v1/quality/inspections').set(bearer(inspector.token))
      .send({ supplierId, redRipePct: '80', greenUnripePct: '10', overripeDamagedPct: '5', decision: 'ACCEPTED' });
    expect(bad.body).toMatchObject({ code: 'PERCENT_SUM_OUT_OF_TOLERANCE', details: { sum: '95.00' } });

    const insp = await inspection(supplierId);
    expect((await api().post('/api/v1/purchases').set(bearer(clerk.token)).send(voucherBody(insp.id))).status).toBe(201);
    const reuse = await api().post('/api/v1/purchases').set(bearer(clerk.token)).send(voucherBody(insp.id));
    expect(reuse.body.code).toBe('INSPECTION_ALREADY_USED');
    const available = await api().get(`/api/v1/quality/inspections?supplierId=${supplierId}&available=true`).set(bearer(clerk.token));
    expect(available.body.meta.total).toBe(0);

    const suspended = await api().patch(`/api/v1/suppliers/${supplierId}/status`).set(bearer(manager.token)).send({ status: 'SUSPENDED', reason: 'ID expired' });
    expect(suspended.body.data).toMatchObject({ status: 'SUSPENDED', statusReason: 'ID expired' });
    const denied = await api().post('/api/v1/quality/inspections').set(bearer(inspector.token))
      .send({ supplierId, redRipePct: '85', greenUnripePct: '10', overripeDamagedPct: '5', decision: 'ACCEPTED' });
    expect(denied.body.code).toBe('SUPPLIER_NOT_ACTIVE');
  });

  it('REJECT rules force a rejection that blocks purchasing; WARN rules are recorded', async () => {
    const reject = await api().post('/api/v1/quality/rules').set(bearer(manager.token))
      .send({ name: 'Too much green', metric: 'GREEN_UNRIPE_PCT', operator: 'GT', threshold: '40', action: 'REJECT' });
    const warn = await api().post('/api/v1/quality/rules').set(bearer(manager.token))
      .send({ name: 'Watch overripe', metric: 'OVERRIPE_DAMAGED_PCT', operator: 'GTE', threshold: '10', action: 'WARN' });
    expect(reject.status).toBe(201);
    try {
      const supplierId = await newSupplier();
      const forced = await api().post('/api/v1/quality/inspections').set(bearer(inspector.token))
        .send({ supplierId, redRipePct: '50', greenUnripePct: '45', overripeDamagedPct: '5', decision: 'ACCEPTED' });
      expect(forced.body.data).toMatchObject({ decision: 'REJECTED', rejectionReason: 'Rejected by rule: Too much green', ruleEvaluation: { outcome: 'REJECT', forcedRejection: true } });
      const pv = await api().post('/api/v1/purchases').set(bearer(clerk.token)).send(voucherBody(forced.body.data.id));
      expect(pv.body.code).toBe('INSPECTION_NOT_ACCEPTED');

      const warned = await inspection(supplierId, inspector, { redRipePct: '80', greenUnripePct: '8', overripeDamagedPct: '12' });
      expect(warned).toMatchObject({ decision: 'ACCEPTED', ruleEvaluation: { outcome: 'WARN' } });
      const manual = await api().post('/api/v1/quality/inspections').set(bearer(inspector.token))
        .send({ supplierId, redRipePct: '85', greenUnripePct: '10', overripeDamagedPct: '5', decision: 'REJECTED' });
      expect(manual.status).toBe(400); // own rejection needs a reason
    } finally {
      for (const r of [reject, warn]) await api().patch(`/api/v1/quality/rules/${r.body.data.id}`).set(bearer(manager.token)).send({ isActive: false });
    }
  });

  it('holds stop a lot (and its children) until released', async () => {
    await setSetting('purchase.lotCreationTrigger', 'ON_APPROVAL');
    let lot: { id: string; lotNumber: string };
    try {
      lot = ((await approvedVoucher()) as unknown as { lot: { id: string; lotNumber: string } }).lot;
    } finally {
      await setSetting('purchase.lotCreationTrigger', 'ON_PAYMENT');
    }
    const clerkHold = await api().post('/api/v1/quality/holds').set(bearer(readOnly.token)).send({ lotNumber: lot.lotNumber, reason: 'Fermented smell' });
    expect(clerkHold.body.code).toBe('FORBIDDEN');
    const hold = await api().post('/api/v1/quality/holds').set(bearer(inspector.token)).send({ lotNumber: lot.lotNumber, reason: 'Fermented smell' });
    expect(hold.status).toBe(201);
    expect(hold.body.data).toMatchObject({ status: 'ACTIVE', stage: 'PURCHASED', lotNumber: lot.lotNumber });
    const twice = await api().post('/api/v1/quality/holds').set(bearer(inspector.token)).send({ lotNumber: lot.lotNumber, reason: 'again' });
    expect(twice.body.code).toBe('LOT_ALREADY_ON_HOLD');

    // A child lot inherits the parent's hold (children arrive in Phase 3; simulated here).
    const child = await ctx.pool.query(
      `INSERT INTO lots (lot_number, type, parent_lot_id, original_cherry_weight_kg, current_weight_kg, processing_date, current_stage, qr_token)
       SELECT lot_number || '-G1', 'GRADE_SPLIT', id, original_cherry_weight_kg, 10, processing_date, 'GRADING', md5(random()::text) FROM lots WHERE id = $1 RETURNING id`,
      [lot.id],
    );
    await expect(ctx.c.lots.assertNotOnHold(ctx.pool, child.rows[0].id)).rejects.toMatchObject({ code: 'LOT_ON_HOLD' });
    expect((await ctx.pool.query('SELECT status FROM lots WHERE id = $1', [lot.id])).rows[0].status).toBe('ON_HOLD');

    const released = await api().post(`/api/v1/quality/holds/${hold.body.data.id}/release`).set(bearer(inspector.token)).send({ notes: 'Re-tested, fine' });
    expect(released.body.data).toMatchObject({ status: 'RELEASED', releasedById: inspector.userId });
    await expect(ctx.c.lots.assertNotOnHold(ctx.pool, child.rows[0].id)).resolves.toBeUndefined();
    const events = await ctx.pool.query('SELECT event_type FROM lot_events WHERE lot_id = $1 ORDER BY sequence', [lot.id]);
    expect(events.rows.map((e) => e.event_type)).toEqual(['PURCHASED', 'QUALITY_HOLD_PLACED', 'QUALITY_HOLD_RELEASED']);
    expect((await ctx.pool.query('SELECT status FROM lots WHERE id = $1', [lot.id])).rows[0].status).toBe('ACTIVE');
  });
});

describe('suppliers, equipment and cash', () => {
  it('enforces unique supplier codes and ID numbers; links documents', async () => {
    const code = uniqueName('F');
    const a = await api().post('/api/v1/suppliers').set(bearer(clerk.token))
      .send({ supplierCode: code, fullName: 'Abebe Bikila', identificationType: 'NATIONAL_ID', identificationNo: `ID-${code}` });
    expect(a.status).toBe(201);
    expect(a.body.data.qrToken).toHaveLength(32);
    expect((await api().post('/api/v1/suppliers').set(bearer(clerk.token)).send({ supplierCode: code, fullName: 'Other' })).body.code).toBe('DUPLICATE');
    const sameId = await api().post('/api/v1/suppliers').set(bearer(clerk.token))
      .send({ supplierCode: uniqueName('F'), fullName: 'Other', identificationType: 'NATIONAL_ID', identificationNo: `ID-${code}` });
    expect(sameId.body.code).toBe('DUPLICATE');
    const half = await api().post('/api/v1/suppliers').set(bearer(clerk.token)).send({ supplierCode: uniqueName('F'), fullName: 'Other', identificationNo: 'X1' });
    expect(half.status).toBe(400);

    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ff3f0005fe02fea7d6a4c50000000049454e44ae426082', 'hex');
    const file = await api().post('/api/v1/files').set(bearer(clerk.token)).field('category', 'SUPPLIER_ID').attach('file', png, 'id.png');
    const link = await api().post(`/api/v1/suppliers/${a.body.data.id}/documents`).set(bearer(clerk.token)).send({ documentId: file.body.data.id, docType: 'National ID' });
    expect(link.status).toBe(201);
    const docs = await api().get(`/api/v1/suppliers/${a.body.data.id}/documents`).set(bearer(manager.token));
    expect(docs.body.data).toEqual([expect.objectContaining({ docType: 'National ID', originalName: 'id.png' })]);

    const list = await api().get(`/api/v1/suppliers?search=${code}`).set(bearer(cashier.token));
    expect(list.body.meta.total).toBe(1);
  });

  it('records maintenance and advances the schedule', async () => {
    const eq = await api().post('/api/v1/equipment').set(bearer(manager.token)).send({ code: uniqueName('PM'), name: 'Pulper 1', type: 'PULPING_MACHINE' });
    expect(eq.status).toBe(201);
    expect((await api().post('/api/v1/equipment').set(bearer(manager.token)).send({ code: uniqueName('S'), name: 'Scale 9', type: 'SCALE' })).body.code).toBe('USE_SCALES_ENDPOINT');
    const sched = await api().post(`/api/v1/equipment/${eq.body.data.id}/schedules`).set(bearer(manager.token)).send({ type: 'CLEANING', intervalDays: 7 });
    expect(sched.status).toBe(201);
    const performedAt = '2026-09-20T08:00:00.000Z';
    const m = await api().post(`/api/v1/equipment/${eq.body.data.id}/maintenance`).set(bearer(manager.token))
      .send({ type: 'CLEANING', performedAt, description: 'Daily clean', result: 'PASS' });
    expect(m.status).toBe(201);
    const schedules = await api().get(`/api/v1/equipment/${eq.body.data.id}/schedules`).set(bearer(manager.token));
    expect(new Date(schedules.body.data[0].nextDueAt).toISOString()).toBe('2026-09-27T08:00:00.000Z');
    const noReason = await api().patch(`/api/v1/equipment/${eq.body.data.id}`).set(bearer(manager.token)).send({ status: 'UNDER_MAINTENANCE' });
    expect(noReason.status).toBe(400);
  });

  it('cash funding and returns post to the append-only ledger', async () => {
    const before = (await api().get('/api/v1/finance/cash/summary').set(bearer(cashier.token))).body.data.balance;
    const fund = await api().post('/api/v1/finance/cash').set(bearer(cashier.token)).send({ type: 'CASH_FUNDING', amount: '100000.00', description: 'Bank withdrawal' });
    expect(fund.body.data).toMatchObject({ direction: 'IN', type: 'CASH_FUNDING', amount: '100000.00', txnNumber: expect.stringMatching(/^CSH-/) });
    await api().post('/api/v1/finance/cash').set(bearer(cashier.token)).send({ type: 'CASH_RETURN', amount: '250.50', description: 'Returned to bank' });
    const after = (await api().get('/api/v1/finance/cash/summary').set(bearer(cashier.token))).body.data.balance;
    expect(Number(after) - Number(before)).toBeCloseTo(99749.5, 2);
    expect((await api().post('/api/v1/finance/cash').set(bearer(readOnly.token)).send({ type: 'CASH_FUNDING', amount: '1', description: 'x y z' })).body.code).toBe('FORBIDDEN');
    await expect(ctx.pool.query('UPDATE cash_transactions SET amount = 1 WHERE id = $1', [fund.body.data.id])).rejects.toMatchObject({ code: 'P0A01' });
  });
});
