import { assertLotMovable, assertStageTransition, canAdvance, LOT_STAGES, nextStage } from '../../src/core/lots/lot-stage.js';
import {
  fermentationTiming, flotationBalance, gradingCheck, machineInspectionResult, outturnPct, pctOf, reconcile,
} from '../../src/modules/processing/domain/wet-rules.js';
import { childLotNumber } from '../../src/modules/processing/washing-grading.service.js';

describe('lot stage machine (§9.2)', () => {
  it('moves forward exactly one stage at a time', () => {
    for (const [i, from] of LOT_STAGES.entries()) {
      for (const [j, to] of LOT_STAGES.entries()) {
        expect(canAdvance(from, to)).toBe(j === i + 1);
        if (j !== i + 1) expect(() => assertStageTransition(from, to)).toThrow(expect.objectContaining({ code: 'LOT_STAGE_INVALID', statusCode: 422 }));
      }
    }
    expect(nextStage('PURCHASED')).toBe('HOPPER');
    expect(nextStage('WASHING')).toBe('GRADING');
    expect(nextStage('RELEASED')).toBeNull();
  });

  it('only ACTIVE lots move', () => {
    expect(() => assertLotMovable('ACTIVE')).not.toThrow();
    expect(() => assertLotMovable('ON_HOLD')).toThrow(expect.objectContaining({ code: 'LOT_ON_HOLD' }));
    for (const s of ['SPLIT', 'CLOSED', 'REJECTED', 'IN_STORE', 'RELEASED'] as const) {
      expect(() => assertLotMovable(s)).toThrow(expect.objectContaining({ code: 'LOT_NOT_ACTIVE' }));
    }
  });
});

describe('flotation balance', () => {
  it('compares floaters + sinkers with the intake', () => {
    expect(flotationBalance('1000', '50', '950', 0)).toMatchObject({ totalKg: '1000.000', differenceKg: '0.000', differencePct: '0.000', withinTolerance: true });
    expect(flotationBalance('1000', '50', '940', 0)).toMatchObject({ differenceKg: '-10.000', differencePct: '1.000', withinTolerance: false });
    expect(flotationBalance('1000', '50', '940', 1)).toMatchObject({ withinTolerance: true }); // exactly at tolerance
    expect(flotationBalance('1000', '50', '939.9', 1).withinTolerance).toBe(false);
  });
});

describe('hopper reconciliation [MANUAL: compare & flag]', () => {
  const line = (lotNumber: string, purchasedKg: string, intakeKg: string) => ({ lotId: lotNumber, lotNumber, purchasedKg, intakeKg });

  it('sums the day and flags differences above the tolerance', () => {
    const r = reconcile([line('A', '500', '498'), line('B', '300', '300')], 0.5);
    expect(r).toMatchObject({ purchasedKg: '800.000', intakeKg: '798.000', differenceKg: '-2.000', differencePct: '0.250', status: 'BALANCED' });
    expect(r.detail.map((d) => [d.differencePct, d.flagged])).toEqual([['0.400', false], ['0.000', false]]);
  });

  it('strict tolerance (0) flags any difference; a single bad lot flags the day', () => {
    expect(reconcile([line('A', '500', '499.999')], 0).status).toBe('DISCREPANCY');
    // day total within 1 %, but lot B alone is 5 % out
    const r = reconcile([line('A', '1000', '1010'), line('B', '200', '190')], 1);
    expect(r.differencePct).toBe('0.000');
    expect(r.status).toBe('DISCREPANCY');
    expect(r.detail.find((d) => d.lotNumber === 'B')?.flagged).toBe(true);
  });

  it('an empty day is balanced', () => {
    expect(reconcile([], 0)).toMatchObject({ purchasedKg: '0.000', differencePct: '0.000', status: 'BALANCED', detail: [] });
  });
});

describe('pulping machine inspection', () => {
  it('passes only when every check is OK', () => {
    expect(machineInspectionResult({ discTeethOk: true, discSpacingOk: true, cleaningDone: true })).toBe('PASS');
    expect(machineInspectionResult({ discTeethOk: true, discSpacingOk: false, cleaningDone: true })).toBe('FAIL');
    expect(machineInspectionResult({ discTeethOk: false, discSpacingOk: true, cleaningDone: true })).toBe('FAIL');
    expect(machineInspectionResult({ discTeethOk: true, discSpacingOk: true, cleaningDone: false })).toBe('FAIL');
  });
});

describe('fermentation window [MANUAL typical 24–48 h]', () => {
  const start = new Date('2026-10-01T06:00:00Z');
  const at = (h: number) => new Date(start.getTime() + h * 3_600_000);
  it('classifies the elapsed time', () => {
    expect(fermentationTiming(start, 24, 48, 2, at(10))).toMatchObject({ state: 'BEFORE_MIN', elapsedHours: '10.0' });
    expect(fermentationTiming(start, 24, 48, 2, at(24)).state).toBe('IN_WINDOW');
    expect(fermentationTiming(start, 24, 48, 2, at(46)).state).toBe('APPROACHING_MAX');
    expect(fermentationTiming(start, 24, 48, 2, at(48)).state).toBe('APPROACHING_MAX');
    expect(fermentationTiming(start, 24, 48, 2, at(48.1)).state).toBe('OVERDUE');
    expect(fermentationTiming(start, 24, 48, 2, at(1)).maxEndAt.toISOString()).toBe('2026-10-03T06:00:00.000Z');
  });
});

describe('grading', () => {
  it('Σ grade outputs ≤ washed output (+ tolerance)', () => {
    expect(gradingCheck(['300', '150.5'], '450.5', 0)).toEqual({ totalKg: '450.500', maxAllowedKg: '450.500', withinLimit: true });
    expect(gradingCheck(['300', '151'], '450.5', 0).withinLimit).toBe(false);
    expect(gradingCheck(['300', '151'], '450.5', 0.5).withinLimit).toBe(true);
  });

  it('names child lots from the LOT_CHILD format', () => {
    expect(childLotNumber('{PARENT}-{GRADE}', 'LOT-261003-0001', 'G1')).toBe('LOT-261003-0001-G1');
    expect(childLotNumber('{GRADE}/{PARENT}', 'L1', 'G2')).toBe('G2/L1');
  });
});

describe('percentages', () => {
  it('outturn = weight / original cherry × 100, 3 dp', () => {
    expect(outturnPct('200', '1000')).toBe('20.000');
    expect(outturnPct('183.33', '1000')).toBe('18.333');
    expect(pctOf('5', '0')).toBe('0.000');
  });
});
