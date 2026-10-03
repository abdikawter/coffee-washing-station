/**
 * Phase 3 exit gate: lot → hopper → flotation → pulping → fermentation → washing
 * → grading (child lots, weights conserved); holds block every step; a tank
 * cannot be double-booked; reconciliation flags discrepancies.
 */
import request from 'supertest';
import { bearer, createRole, createTestApp, tokenFor, uniqueName, type TestContext } from '../helpers/app.js';

let ctx: TestContext;
let admin: { token: string; userId: string };
let readOnly: { token: string };
let coffeeTypeId: string;
let scaleId: string;
let grades: Record<string, string>;
let hopperId: string;

const api = () => request(ctx.app);
const post = (path: string, body: object = {}) => api().post(`/api/v1${path}`).set(bearer(admin.token)).send(body);
const get = (path: string) => api().get(`/api/v1${path}`).set(bearer(admin.token));
const setSetting = (key: string, value: unknown) => ctx.pool.query('UPDATE system_settings SET value = $2 WHERE key = $1', [key, JSON.stringify(value)]);

/** Runs a purchase end to end (inspection → voucher → approve → pay) and returns the PURCHASED lot (89.300 kg). */
async function purchasedLot(): Promise<{ id: string; lotNumber: string }> {
  const sup = await post('/suppliers', { supplierCode: uniqueName('F'), fullName: 'Tigist Bekele' });
  const insp = await post('/quality/inspections', { supplierId: sup.body.data.id, redRipePct: '90', greenUnripePct: '6', overripeDamagedPct: '4', decision: 'ACCEPTED' });
  let v = (await post('/purchases', {
    qualityInspectionId: insp.body.data.id, coffeeTypeId, pricePerKg: '45',
    items: [{ weighings: [{ scaleId, grossKg: '50.100', tareKg: '0.500' }, { scaleId, grossKg: '40.200', tareKg: '0.500' }] }],
  })).body.data;
  for (const cmd of ['submit', 'verify', 'approve']) v = (await post(`/purchases/${v.id}/${cmd}`, { version: v.version })).body.data;
  const p = (await post('/payments', { voucherId: v.id, method: 'CASH' })).body.data;
  await post(`/payments/${p.id}/approve`);
  await post(`/payments/${p.id}/disburse`);
  const lot = (await get(`/purchases/${v.id}`)).body.data.lot;
  expect(lot).toMatchObject({ currentStage: 'PURCHASED' });
  return lot;
}

async function unit(path: string, body: object = {}): Promise<string> {
  const res = await post(path, { code: uniqueName('U'), name: 'Unit 1', ...body });
  expect(res.status).toBe(201);
  return res.body.data.id;
}

async function inspectedPulper(): Promise<string> {
  const id = await unit('/pulping/machines');
  expect((await post(`/pulping/machines/${id}/inspections`, { discTeethOk: true, discSpacingOk: true, cleaningDone: true })).body.data.result).toBe('PASS');
  return id;
}

/** Takes a PURCHASED lot through hopper + flotation (sinkers 85.000 kg). */
async function floated(lotId: string): Promise<void> {
  const intake = await post('/hopper/intakes', { lotId, hopperId, intakeKg: '89.300' });
  expect(intake.status).toBe(201);
  expect((await post(`/hopper/intakes/${intake.body.data.id}/flotation`, { floatersKg: '4.300', sinkersKg: '85.000' })).status).toBe(200);
}

beforeAll(async () => {
  ctx = await createTestApp();
  admin = await tokenFor(ctx, ['SUPER_ADMIN']);
  const { rows } = await ctx.pool.query(`SELECT code FROM permissions WHERE code LIKE '%:read'`);
  readOnly = await tokenFor(ctx, [await createRole(ctx.pool, rows.map((r) => r.code))]);
  coffeeTypeId = (await get('/coffee-types')).body.data.find((t: { code: string }) => t.code === 'RED_CHERRY').id;
  grades = Object.fromEntries((await get('/quality/grades?stage=PARCHMENT')).body.data.map((g: { code: string; id: string }) => [g.code, g.id]));
  scaleId = (await post('/scales', { code: uniqueName('SC'), name: 'Scale', capacityKg: '500' })).body.data.id;
  await post(`/scales/${scaleId}/calibrations`, { standardWeightKg: '20', readingKg: '20', result: 'PASS' });
  hopperId = await unit('/hoppers', { capacityKg: '2000' });
  // Settings this file relies on (other test files may have changed them).
  await setSetting('hopper.flotationBalanceTolerancePct', 0);
  await setSetting('hopper.reconciliationTolerancePct', 0);
  await setSetting('controls.correctiveActionMode', 'RECOMMEND');
  await setSetting('pulping.dailyInspectionPolicy', 'BLOCK');
}, 60_000);
afterAll(() => ctx.close());

describe('wet processing end to end', () => {
  it('lot → hopper → flotation → pulping → fermentation → washing → grading with child lots', async () => {
    const lot = await purchasedLot();
    const pulper = await inspectedPulper();
    const tank = await unit('/fermentation/tanks', { capacityKg: '5000' });

    const intake = await post('/hopper/intakes', { lotId: lot.id, hopperId, intakeKg: '89.300' });
    expect(intake.body.data).toMatchObject({ lotNumber: lot.lotNumber, purchasedCherryKg: '89.300', intakeKg: '89.300', warnings: [] });
    const flot = await post(`/hopper/intakes/${intake.body.data.id}/flotation`, { floatersKg: '4.300', sinkersKg: '85.000' });
    expect(flot.body.data).toMatchObject({ balance: { withinTolerance: true, differenceKg: '0.000' }, correctiveAction: null });

    const pulp = await post('/pulping/records', { lotId: lot.id, machineId: pulper });
    expect(pulp.body.data).toMatchObject({ inputKg: '85.000', outputKg: null, inspectionProblem: null });
    const early = await post('/fermentation/batches', { lotId: lot.id, tankId: tank });
    expect(early.body.code).toBe('PULPING_NOT_COMPLETED');
    expect((await post(`/pulping/records/${pulp.body.data.id}/complete`, { outputKg: '60.000' })).body.data.outputKg).toBe('60.000');

    const fb = await post('/fermentation/batches', { lotId: lot.id, tankId: tank });
    expect(fb.status).toBe(201);
    expect(fb.body.data).toMatchObject({ batchNumber: expect.stringMatching(/^FB-\d{6}-\d{3}$/), inputKg: '60.000', minDurationHours: '24.0', maxDurationHours: '48.0', timing: { state: 'BEFORE_MIN' } });
    const noMucilage = await post(`/fermentation/batches/${fb.body.data.id}/complete`, { reason: 'Test run' });
    expect(noMucilage.body.code).toBe('MUCILAGE_NOT_COMPLETE');
    const m = await post(`/fermentation/batches/${fb.body.data.id}/measurements`, { temperatureC: '21.5', ph: '4.2', mucilageAssessment: 'COMPLETE' });
    expect(m.status).toBe(201);
    expect(m.body.data.mucilageAssessment).toBe('COMPLETE');
    const noReason = await post(`/fermentation/batches/${fb.body.data.id}/complete`, {});
    expect(noReason.body).toMatchObject({ code: 'EARLY_COMPLETION_REASON_REQUIRED' });
    const done = await post(`/fermentation/batches/${fb.body.data.id}/complete`, { reason: 'Mucilage fully broken down' });
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', correctiveAction: null });

    const tooMuch = await post('/washing/records', { lotId: lot.id, outputKg: '61' });
    expect(tooMuch.body.code).toBe('OUTPUT_EXCEEDS_INPUT');
    expect((await post('/washing/records', { lotId: lot.id, outputKg: '55.500' })).status).toBe(201);

    const over = await post('/grading/records', { lotId: lot.id, outputs: [{ gradeId: grades.G1, weightKg: '40' }, { gradeId: grades.G2, weightKg: '16' }] });
    expect(over.body.code).toBe('GRADING_EXCEEDS_WASHED');
    const graded = await post('/grading/records', { lotId: lot.id, outputs: [{ gradeId: grades.G1, weightKg: '40.000' }, { gradeId: grades.G2, weightKg: '15.500' }] });
    expect(graded.status).toBe(201);
    expect(graded.body.data.children.map((c: { lotNumber: string; weightKg: string }) => [c.lotNumber, c.weightKg])).toEqual([
      [`${lot.lotNumber}-G1`, '40.000'], [`${lot.lotNumber}-G2`, '15.500'],
    ]);

    const parent = (await get(`/lots/${lot.id}`)).body.data;
    expect(parent).toMatchObject({ currentStage: 'GRADING', status: 'SPLIT', currentWeightKg: '55.500' });
    expect(parent.children).toHaveLength(2);
    const events = (await get(`/lots/${lot.id}/events`)).body.data.map((e: { eventType: string; stage: string; quantityKg: string }) => [e.eventType, e.stage, e.quantityKg]);
    expect(events).toEqual([
      ['PURCHASED', 'PURCHASED', '89.300'],
      ['HOPPER_RECEIVED', 'HOPPER', '89.300'],
      ['FLOTATION_COMPLETED', 'FLOTATION', '85.000'],
      ['PULPED', 'PULPING', '85.000'],
      ['FERMENTATION_STARTED', 'FERMENTATION', '60.000'],
      ['FERMENTATION_COMPLETED', 'FERMENTATION', '60.000'],
      ['WASHED', 'WASHING', '55.500'],
      ['GRADED', 'GRADING', '55.500'],
      ['LOT_SPLIT', 'GRADING', '55.500'],
    ]);

    const g1 = graded.body.data.children[0];
    const child = (await get(`/lots/${g1.id}`)).body.data;
    expect(child).toMatchObject({ type: 'GRADE_SPLIT', currentStage: 'GRADING', status: 'ACTIVE', parentLotNumber: lot.lotNumber, gradeCode: 'G1', originalCherryWeightKg: '89.300' });
    const childEvents = (await get(`/lots/${g1.id}/events`)).body.data;
    expect(childEvents.at(-1)).toMatchObject({ lotNumber: g1.lotNumber, eventType: 'LOT_SPLIT', quantityKg: '40.000' });
    expect(childEvents.length).toBe(events.length + 1); // parent history + its own split event

    const outturn = (await get(`/lots/${g1.id}/outturn`)).body.data;
    expect(outturn.steps.map((s: { key: string; outturnPct: string }) => [s.key, s.outturnPct])).toEqual([
      ['PURCHASED', '100.000'], ['HOPPER', '100.000'], ['FLOTATION', '95.185'], ['PULPING', '67.189'], ['WASHING', '62.150'], ['GRADING', '62.150'], ['GRADE', '44.793'],
    ]);

    const board = (await get('/lots/board')).body.data.stages;
    const grading = board.find((s: { stage: string }) => s.stage === 'GRADING').lots.map((l: { lotNumber: string }) => l.lotNumber);
    expect(grading).toEqual(expect.arrayContaining([`${lot.lotNumber}-G1`, `${lot.lotNumber}-G2`]));
    expect(grading).not.toContain(lot.lotNumber); // SPLIT parents leave the board
    const audit = await ctx.pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE module = 'processing' AND new_value->>'lotNumber' = $1`, [lot.lotNumber]);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(7);
  });
});

describe('stage rules and holds', () => {
  it('enforces the stage order', async () => {
    const lot = await purchasedLot();
    const pulper = await inspectedPulper();
    expect((await post('/pulping/records', { lotId: lot.id, machineId: pulper })).body).toMatchObject({ code: 'LOT_STAGE_INVALID', details: { currentStage: 'PURCHASED', expectedStage: 'FLOTATION' } });
    expect((await post('/washing/records', { lotId: lot.id, outputKg: '1' })).body.code).toBe('LOT_STAGE_INVALID');
    await post('/hopper/intakes', { lotId: lot.id, hopperId, intakeKg: '89.300' });
    expect((await post('/hopper/intakes', { lotId: lot.id, hopperId, intakeKg: '89.300' })).body.code).toBe('LOT_STAGE_INVALID');
  });

  it('a quality hold blocks every step until released', async () => {
    const lot = await purchasedLot();
    const hold = await post('/quality/holds', { lotNumber: lot.lotNumber, reason: 'Foreign matter found' });
    expect(hold.status).toBe(201);
    const blocked = await post('/hopper/intakes', { lotId: lot.id, hopperId, intakeKg: '89.300' });
    expect(blocked.body).toMatchObject({ statusCode: 422, code: 'LOT_ON_HOLD', details: { reason: 'Foreign matter found' } });
    await post(`/quality/holds/${hold.body.data.id}/release`, { notes: 'Removed and re-checked' });
    await floated(lot.id);

    // hold again mid-way: pulping is refused
    const pulper = await inspectedPulper();
    const hold2 = await post('/quality/holds', { lotNumber: lot.lotNumber, reason: 'Second check' });
    expect((await post('/pulping/records', { lotId: lot.id, machineId: pulper })).body.code).toBe('LOT_ON_HOLD');
    await post(`/quality/holds/${hold2.body.data.id}/release`, { notes: 'Checked again, fine' });
    expect((await post('/pulping/records', { lotId: lot.id, machineId: pulper })).status).toBe(201);
  });

  it('commands need their permission', async () => {
    const res = await api().post('/api/v1/hopper/intakes').set(bearer(readOnly.token)).send({});
    expect(res.body.code).toBe('FORBIDDEN');
    expect((await api().get('/api/v1/lots/board').set(bearer(readOnly.token))).status).toBe(200);
  });
});

describe('equipment rules', () => {
  it('pulping without a passing inspection: BLOCK refuses, WARN allows and flags', async () => {
    const lot = await purchasedLot();
    await floated(lot.id);
    const machine = await unit('/pulping/machines'); // not inspected today
    expect((await post('/pulping/records', { lotId: lot.id, machineId: machine })).body).toMatchObject({ code: 'PULPING_INSPECTION_REQUIRED', details: { problem: 'MISSING', policy: 'BLOCK' } });

    const failed = await post(`/pulping/machines/${machine}/inspections`, { discTeethOk: true, discSpacingOk: false, cleaningDone: true });
    expect(failed.body.data.result).toBe('FAIL');
    expect((await post(`/pulping/machines/${machine}/inspections`, { discTeethOk: true, discSpacingOk: true, cleaningDone: true })).body.code).toBe('INSPECTION_ALREADY_RECORDED');

    await setSetting('pulping.dailyInspectionPolicy', 'WARN');
    try {
      const warned = await post('/pulping/records', { lotId: lot.id, machineId: machine, outputKg: '60' });
      expect(warned.status).toBe(201);
      expect(warned.body.data).toMatchObject({ inspectionProblem: 'FAILED', correctiveAction: { mode: 'RECOMMEND', correctiveAction: null }, outputKg: '60.000' });
      const rec = await ctx.pool.query(`SELECT payload FROM outbox_events WHERE event_type = 'corrective-action.recommended' AND aggregate_id = $1`, [lot.id]);
      expect(rec.rows[0].payload).toMatchObject({ source: 'PROCESS_VIOLATION' });
    } finally {
      await setSetting('pulping.dailyInspectionPolicy', 'BLOCK');
    }
  });

  it('a tank cannot hold two batches, even with parallel requests', async () => {
    const tank = await unit('/fermentation/tanks', { capacityKg: '5000' });
    const pulper = await inspectedPulper();
    const lots = [await purchasedLot(), await purchasedLot()];
    for (const l of lots) {
      await floated(l.id);
      await post('/pulping/records', { lotId: l.id, machineId: pulper, outputKg: '60' });
    }
    const results = await Promise.all(lots.map((l) => post('/fermentation/batches', { lotId: l.id, tankId: tank })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.find((r) => r.status !== 201)!.body.code).toMatch(/TANK_OCCUPIED|DUPLICATE/);

    const small = await unit('/fermentation/tanks', { capacityKg: '10' });
    const loser = lots[results.findIndex((r) => r.status !== 201)]!;
    expect((await post('/fermentation/batches', { lotId: loser.id, tankId: small })).body.code).toBe('TANK_CAPACITY_EXCEEDED');
  });

  it('equipment out of service cannot be used', async () => {
    const lot = await purchasedLot();
    const h = await unit('/hoppers', { capacityKg: '50' });
    const eq = (await get('/hoppers')).body.data.find((x: { id: string }) => x.id === h);
    await api().patch(`/api/v1/equipment/${eq.equipmentId}`).set(bearer(admin.token)).send({ status: 'UNDER_MAINTENANCE', reason: 'Cleaning' });
    expect((await post('/hopper/intakes', { lotId: lot.id, hopperId: h, intakeKg: '89.300' })).body.code).toBe('EQUIPMENT_NOT_OPERATIONAL');
    await api().patch(`/api/v1/equipment/${eq.equipmentId}`).set(bearer(admin.token)).send({ status: 'OPERATIONAL', reason: 'Clean' });
    const ok = await post('/hopper/intakes', { lotId: lot.id, hopperId: h, intakeKg: '89.300' });
    expect(ok.body.data.warnings).toEqual([expect.stringMatching(/exceeds hopper .* capacity \(50\.000 kg\)/)]); // allowed, with a warning
  });
});

describe('controls', () => {
  it('flotation imbalance: RECOMMEND signals, AUTO_CREATE opens a corrective action', async () => {
    const lot = await purchasedLot();
    const intake = await post('/hopper/intakes', { lotId: lot.id, hopperId, intakeKg: '89.300' });
    await setSetting('controls.correctiveActionMode', 'AUTO_CREATE');
    try {
      const res = await post(`/hopper/intakes/${intake.body.data.id}/flotation`, { floatersKg: '4', sinkersKg: '80' });
      expect(res.body.data.balance).toMatchObject({ withinTolerance: false, differenceKg: '-5.300' });
      expect(res.body.data.correctiveAction).toMatchObject({ mode: 'AUTO_CREATE', correctiveAction: { caNumber: expect.stringMatching(/^CA-/) } });
      const ca = await ctx.pool.query('SELECT source, lot_id FROM corrective_actions WHERE id = $1', [res.body.data.correctiveAction.correctiveAction.id]);
      expect(ca.rows[0]).toEqual({ source: 'WEIGHT_DISCREPANCY', lot_id: lot.id });
    } finally {
      await setSetting('controls.correctiveActionMode', 'RECOMMEND');
    }
  });

  it('an overdue fermentation is flagged at completion', async () => {
    const lot = await purchasedLot();
    await floated(lot.id);
    await post('/pulping/records', { lotId: lot.id, machineId: await inspectedPulper(), outputKg: '60' });
    const fb = (await post('/fermentation/batches', { lotId: lot.id, tankId: await unit('/fermentation/tanks', { capacityKg: '500' }) })).body.data;
    await ctx.pool.query(`UPDATE fermentation_batches SET start_at = now() - interval '50 hours' WHERE id = $1`, [fb.id]);
    expect((await get(`/fermentation/batches/${fb.id}`)).body.data.timing.state).toBe('OVERDUE');
    await post(`/fermentation/batches/${fb.id}/measurements`, { mucilageAssessment: 'COMPLETE' });
    const done = await post(`/fermentation/batches/${fb.id}/complete`, {});
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', correctiveAction: { mode: 'RECOMMEND' } });
    const late = await ctx.c.processing.fermentation.monitor();
    expect(late.find((b) => b.batchNumber === fb.batchNumber)).toBeUndefined(); // completed batches are not monitored
  });

  it('daily reconciliation flags differences, is reviewed, then locked', async () => {
    // Today's intakes include one at 89.300 kg for a 89.300 kg lot and others; make one differ.
    const lot = await purchasedLot();
    await post('/hopper/intakes', { lotId: lot.id, hopperId, intakeKg: '88.000' });
    const run = await post('/hopper/reconciliations/run', {});
    expect(run.status).toBe(200);
    expect(run.body.data).toMatchObject({ status: 'DISCREPANCY', tolerancePct: '0.00', correctiveAction: { mode: 'RECOMMEND' } });
    const flagged = run.body.data.detail.filter((d: { flagged: boolean }) => d.flagged).map((d: { lotNumber: string }) => d.lotNumber);
    expect(flagged).toContain(lot.lotNumber);

    const again = await post('/hopper/reconciliations/run', {});
    expect(again.body.data).toMatchObject({ id: run.body.data.id, correctiveAction: null }); // re-run updates the day, no second CA
    const review = await post(`/hopper/reconciliations/${run.body.data.id}/review`, { notes: 'Lost moisture in transport; accepted' });
    expect(review.body.data).toMatchObject({ status: 'REVIEWED', reviewNotes: 'Lost moisture in transport; accepted' });
    expect((await post('/hopper/reconciliations/run', {})).body.code).toBe('RECONCILIATION_REVIEWED');
    expect((await post('/hopper/reconciliations/run', { date: '2999-01-01' })).body.code).toBe('FUTURE_DATED');
    const list = (await get('/hopper/reconciliations?status=REVIEWED')).body;
    expect(list.data[0].id).toBe(run.body.data.id);
  });
});
