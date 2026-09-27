import { assertAcceptableEntryTime } from '../../src/common/business-time.js';
import { evaluateCalibration, scaleVerificationAt } from '../../src/modules/equipment/domain/scale-verification.js';
import { nextPaymentStatus, PAYMENT_STATUSES, PAYMENT_TRANSITIONS, type PaymentCommand } from '../../src/modules/payments/domain/payment-state-machine.js';
import { computeVoucher, netWeight } from '../../src/modules/purchasing/domain/purchase-calculator.js';
import {
  canTransition, nextVoucherStatus, VOUCHER_STATUSES, VOUCHER_TRANSITIONS, type VoucherCommand,
} from '../../src/modules/purchasing/domain/voucher-state-machine.js';
import { evaluateQualityRules, percentSumWithinTolerance, ruleTriggered, type QualityRule } from '../../src/modules/quality/domain/quality-rules.js';

describe('purchase calculator (§11.2 [MANUAL])', () => {
  it('net = gross − tare, exact to the gram', () => {
    expect(netWeight({ grossKg: '60.25', tareKg: '0.8' })).toBe('59.450');
    expect(() => netWeight({ grossKg: '10', tareKg: '10' })).toThrow(/Tare/);
    expect(() => netWeight({ grossKg: '0', tareKg: '0' })).toThrow(/Gross/);
  });

  it('amount = weight × price per line; totals are sums; no float error', () => {
    const v = computeVoucher([
      { pricePerKg: '45.10', weighings: [{ grossKg: '50.100', tareKg: '0.5' }, { grossKg: '40.2', tareKg: '0.5' }] },
      { pricePerKg: '0.1', weighings: [{ grossKg: '0.3', tareKg: '0' }] },
    ]);
    expect(v.items[0]).toMatchObject({ lineNo: 1, weightKg: '89.300', amount: '4027.43' }); // 89.3 × 45.10 = 4027.43
    expect(v.items[1]).toMatchObject({ lineNo: 2, weightKg: '0.300', amount: '0.03' });
    expect(v.totalWeightKg).toBe('89.600');
    expect(v.totalAmount).toBe('4027.46');
  });

  it('rounds each line with the configured mode', () => {
    const items = [{ pricePerKg: '10.01', weighings: [{ grossKg: '0.5', tareKg: '0' }] }]; // 5.005
    expect(computeVoucher(items, 'HALF_UP').totalAmount).toBe('5.01');
    expect(computeVoucher(items, 'HALF_EVEN').totalAmount).toBe('5.00');
    expect(computeVoucher(items, 'DOWN').totalAmount).toBe('5.00');
  });

  it('needs items and weighings', () => {
    expect(() => computeVoucher([])).toThrow(/at least one item/);
    expect(() => computeVoucher([{ pricePerKg: '1', weighings: [] }])).toThrow(/no weight records/);
  });
});

describe('voucher state machine (§9.2)', () => {
  const ALLOWED: Record<VoucherCommand, Partial<Record<string, string>>> = {
    update: { DRAFT: 'DRAFT' },
    submit: { DRAFT: 'PENDING_VERIFICATION' },
    verify: { PENDING_VERIFICATION: 'VERIFIED' },
    return: { PENDING_VERIFICATION: 'DRAFT', VERIFIED: 'DRAFT' },
    approve: { VERIFIED: 'APPROVED' },
    cancel: { DRAFT: 'CANCELLED', PENDING_VERIFICATION: 'CANCELLED', VERIFIED: 'CANCELLED' },
    void: { APPROVED: 'VOIDED' },
    pay: { APPROVED: 'PAID' },
    reversePayment: { PAID: 'APPROVED' },
  };

  it('allows exactly the listed transitions and forbids every other one', () => {
    for (const cmd of Object.keys(VOUCHER_TRANSITIONS) as VoucherCommand[]) {
      for (const status of VOUCHER_STATUSES) {
        const expected = ALLOWED[cmd][status];
        if (expected) {
          expect(nextVoucherStatus(status, cmd)).toBe(expected);
        } else {
          expect(canTransition(status, cmd)).toBe(false);
          expect(() => nextVoucherStatus(status, cmd)).toThrow(expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION', statusCode: 422 }));
        }
      }
    }
  });

  it('terminal states accept no command', () => {
    for (const status of ['CANCELLED', 'VOIDED'] as const) {
      for (const cmd of Object.keys(VOUCHER_TRANSITIONS) as VoucherCommand[]) expect(canTransition(status, cmd)).toBe(false);
    }
  });
});

describe('payment state machine (§9.2)', () => {
  const ALLOWED: Record<PaymentCommand, Partial<Record<string, string>>> = {
    approve: { PENDING_APPROVAL: 'APPROVED' },
    reject: { PENDING_APPROVAL: 'REJECTED' },
    disburse: { APPROVED: 'PAID' },
    reverse: { PAID: 'REVERSED' },
  };
  it('allows exactly the listed transitions', () => {
    for (const cmd of Object.keys(PAYMENT_TRANSITIONS) as PaymentCommand[]) {
      for (const status of PAYMENT_STATUSES) {
        const expected = ALLOWED[cmd][status];
        if (expected) expect(nextPaymentStatus(status, cmd)).toBe(expected);
        else expect(() => nextPaymentStatus(status, cmd)).toThrow(expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }));
      }
    }
  });
});

describe('quality rules', () => {
  const rule = (over: Partial<QualityRule>): QualityRule => ({
    id: 'r', name: 'rule', metric: 'GREEN_UNRIPE_PCT', operator: 'GT', threshold: '10', action: 'REJECT', ...over,
  });
  const sample = { redRipePct: '85', greenUnripePct: '10', overripeDamagedPct: '5' };

  it('compares with every operator at the boundary', () => {
    expect(ruleTriggered({ operator: 'GT', threshold: '10' }, '10')).toBe(false);
    expect(ruleTriggered({ operator: 'GTE', threshold: '10' }, '10')).toBe(true);
    expect(ruleTriggered({ operator: 'LT', threshold: '80' }, '79.99')).toBe(true);
    expect(ruleTriggered({ operator: 'LTE', threshold: '80' }, '80.01')).toBe(false);
  });

  it('REJECT beats WARN; no rules → PASS', () => {
    expect(evaluateQualityRules([], sample).outcome).toBe('PASS');
    expect(evaluateQualityRules([rule({ action: 'WARN', operator: 'GTE' })], sample).outcome).toBe('WARN');
    const r = evaluateQualityRules([rule({ action: 'WARN', operator: 'GTE' }), rule({ id: 'x', metric: 'RED_RIPE_PCT', operator: 'LT', threshold: '90' })], sample);
    expect(r.outcome).toBe('REJECT');
    expect(r.results.map((x) => x.triggered)).toEqual([true, true]);
    expect(r.percentSum).toBe('100.00');
  });

  it('percentages must sum to 100 within the tolerance', () => {
    expect(percentSumWithinTolerance({ redRipePct: '80', greenUnripePct: '15', overripeDamagedPct: '5.5' }, 0.5)).toBe(true);
    expect(percentSumWithinTolerance({ redRipePct: '80', greenUnripePct: '15', overripeDamagedPct: '5.51' }, 0.5)).toBe(false);
    expect(percentSumWithinTolerance({ redRipePct: '80', greenUnripePct: '15', overripeDamagedPct: '4.6' }, 0.5)).toBe(true);
  });
});

describe('scale verification [MANUAL: daily]', () => {
  it('PASS when |reading − standard| ≤ tolerance', () => {
    expect(evaluateCalibration({ standardWeightKg: '20', readingKg: '20.05', toleranceKg: 0.05 })).toEqual({ deviationKg: '0.050', result: 'PASS', resultSource: 'TOLERANCE' });
    expect(evaluateCalibration({ standardWeightKg: '20', readingKg: '19.94', toleranceKg: 0.05 }).result).toBe('FAIL');
    // the rule decides even if the verifier says otherwise
    expect(evaluateCalibration({ standardWeightKg: '20', readingKg: '25', toleranceKg: 0.05, manualResult: 'PASS' }).result).toBe('FAIL');
  });

  it('UNSET tolerance: the verifier records the result explicitly', () => {
    expect(() => evaluateCalibration({ standardWeightKg: '20', readingKg: '20', toleranceKg: null })).toThrow(expect.objectContaining({ code: 'CALIBRATION_RESULT_REQUIRED' }));
    expect(evaluateCalibration({ standardWeightKg: '20', readingKg: '20.3', toleranceKg: null, manualResult: 'PASS' })).toMatchObject({ result: 'PASS', resultSource: 'MANUAL' });
  });

  it('is valid for scale.verificationFrequencyHours after a PASS, only while operational', () => {
    const at = new Date('2026-09-27T10:00:00Z');
    const pass = (hoursAgo: number) => ({ calibratedAt: new Date(at.getTime() - hoursAgo * 3_600_000), result: 'PASS' as const });
    expect(scaleVerificationAt('OPERATIONAL', pass(23), at, 24)).toMatchObject({ verified: true });
    expect(scaleVerificationAt('OPERATIONAL', pass(24), at, 24)).toMatchObject({ verified: false, reason: 'EXPIRED' });
    expect(scaleVerificationAt('OPERATIONAL', null, at, 24)).toMatchObject({ verified: false, reason: 'NEVER_VERIFIED' });
    expect(scaleVerificationAt('OPERATIONAL', { ...pass(1), result: 'FAIL' }, at, 24)).toMatchObject({ reason: 'LAST_CHECK_FAILED' });
    expect(scaleVerificationAt('OUT_OF_SERVICE', pass(1), at, 24)).toMatchObject({ reason: 'OUT_OF_SERVICE' });
  });
});

describe('entry time limits (ops.maxBackdateHours)', () => {
  const now = new Date('2026-09-27T10:00:00Z');
  it('accepts recent times, rejects the future and old backdating', () => {
    expect(() => assertAcceptableEntryTime(new Date('2026-09-27T02:00:00Z'), 24, now)).not.toThrow();
    expect(() => assertAcceptableEntryTime(new Date('2026-09-27T10:05:00Z'), 24, now)).toThrow(expect.objectContaining({ code: 'FUTURE_DATED' }));
    expect(() => assertAcceptableEntryTime(new Date('2026-09-26T09:00:00Z'), 24, now)).toThrow(expect.objectContaining({ code: 'BACKDATE_LIMIT_EXCEEDED' }));
  });
});
