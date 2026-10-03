import { Decimal, kg } from '../../../common/decimal.js';

type Num = string | number | Decimal;

/**
 * Wet-processing rules (ARCHITECTURE.md §9.1, §11.2). Pure functions; weights
 * are decimal strings, percentages are returned with 3 decimals.
 */

/** |diff| / base × 100, exact (0 when base is 0). Compare with this, display pctOf(). */
export function pctExact(diff: Num, base: Num): Decimal {
  const b = new Decimal(base);
  return b.isZero() ? new Decimal(0) : new Decimal(diff).abs().div(b).times(100);
}

/** |diff| / base × 100 rounded to 3 dp for display. */
export function pctOf(diff: Num, base: Num): string {
  return pctExact(diff, base).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
}

// ---------------------------------------------------------------- flotation

export interface FlotationBalance {
  totalKg: string;
  differenceKg: string;
  differencePct: string;
  tolerancePct: number;
  withinTolerance: boolean;
}

/**
 * Floaters + sinkers vs intake (setting hopper.flotationBalanceTolerancePct;
 * 0 = strict: any difference is flagged).
 */
export function flotationBalance(intakeKg: string, floatersKg: string, sinkersKg: string, tolerancePct: number): FlotationBalance {
  const total = new Decimal(floatersKg).plus(sinkersKg);
  const diff = total.minus(intakeKg);
  return {
    totalKg: kg(total), differenceKg: kg(diff), differencePct: pctOf(diff, intakeKg), tolerancePct,
    withinTolerance: pctExact(diff, intakeKg).lte(tolerancePct),
  };
}

// ---------------------------------------------------------------- reconciliation

export interface ReconciliationLine {
  lotId: string;
  lotNumber: string;
  purchasedKg: string;
  intakeKg: string;
}

export interface ReconciliationResult {
  purchasedKg: string;
  intakeKg: string;
  differenceKg: string;
  differencePct: string;
  tolerancePct: number;
  status: 'BALANCED' | 'DISCREPANCY';
  detail: (ReconciliationLine & { differenceKg: string; differencePct: string; flagged: boolean })[];
}

/**
 * Daily hopper reconciliation [MANUAL: compare & flag]:
 *   diff = intake − purchased;  diff% = |diff| / purchased × 100;
 *   flagged when diff% > hopper.reconciliationTolerancePct (0 = every difference).
 * The day is flagged when the day total or any single lot is out of tolerance.
 */
export function reconcile(lines: ReconciliationLine[], tolerancePct: number): ReconciliationResult {
  const detail = lines.map((l) => {
    const d = new Decimal(l.intakeKg).minus(l.purchasedKg);
    return { ...l, differenceKg: kg(d), differencePct: pctOf(d, l.purchasedKg), flagged: pctExact(d, l.purchasedKg).gt(tolerancePct) };
  });
  const purchased = detail.reduce((a, l) => a.plus(l.purchasedKg), new Decimal(0));
  const intake = detail.reduce((a, l) => a.plus(l.intakeKg), new Decimal(0));
  const diff = intake.minus(purchased);
  const flagged = pctExact(diff, purchased).gt(tolerancePct) || detail.some((l) => l.flagged);
  return {
    purchasedKg: kg(purchased), intakeKg: kg(intake), differenceKg: kg(diff), differencePct: pctOf(diff, purchased), tolerancePct,
    status: flagged ? 'DISCREPANCY' : 'BALANCED', detail,
  };
}

// ---------------------------------------------------------------- pulping

export interface MachineCheck {
  discTeethOk: boolean;
  discSpacingOk: boolean;
  cleaningDone: boolean;
}

/** Daily pulping-machine inspection: PASS only when every check is OK. */
export function machineInspectionResult(c: MachineCheck): 'PASS' | 'FAIL' {
  return c.discTeethOk && c.discSpacingOk && c.cleaningDone ? 'PASS' : 'FAIL';
}

// ---------------------------------------------------------------- fermentation

export type FermentationTimingState = 'BEFORE_MIN' | 'IN_WINDOW' | 'APPROACHING_MAX' | 'OVERDUE';

export interface FermentationTiming {
  elapsedHours: string;
  minEndAt: Date;
  maxEndAt: Date;
  state: FermentationTimingState;
}

/**
 * Fermentation window [MANUAL typical 24–48 h] snapshotted on the batch:
 * BEFORE_MIN → IN_WINDOW → APPROACHING_MAX (within lead hours of max) → OVERDUE.
 */
export function fermentationTiming(startAt: Date, minHours: number, maxHours: number, leadHours: number, now = new Date()): FermentationTiming {
  const h = 3_600_000;
  const elapsed = (now.getTime() - startAt.getTime()) / h;
  const minEndAt = new Date(startAt.getTime() + minHours * h);
  const maxEndAt = new Date(startAt.getTime() + maxHours * h);
  const state: FermentationTimingState =
    elapsed > maxHours ? 'OVERDUE' : elapsed >= maxHours - leadHours ? 'APPROACHING_MAX' : elapsed >= minHours ? 'IN_WINDOW' : 'BEFORE_MIN';
  return { elapsedHours: new Decimal(Math.max(elapsed, 0)).toDecimalPlaces(1).toFixed(1), minEndAt, maxEndAt, state };
}

// ---------------------------------------------------------------- grading

export interface GradingCheck {
  totalKg: string;
  maxAllowedKg: string;
  withinLimit: boolean;
}

/** Σ grade outputs ≤ washed output × (1 + grading.outputTolerancePct / 100); 0 = strict. */
export function gradingCheck(outputsKg: string[], washedKg: string, tolerancePct: number): GradingCheck {
  const total = outputsKg.reduce((a, w) => a.plus(w), new Decimal(0));
  const max = new Decimal(washedKg).times(new Decimal(100).plus(tolerancePct)).div(100);
  return { totalKg: kg(total), maxAllowedKg: kg(max), withinLimit: total.lte(max) };
}

/** Outturn so far: weight / original cherry × 100 (§11.2 [MANUAL]). */
export function outturnPct(weightKg: string, originalCherryKg: string): string {
  return pctOf(weightKg, originalCherryKg);
}
