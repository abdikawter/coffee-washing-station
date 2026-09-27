import { BusinessRuleError } from '../../../common/errors.js';
import { Decimal, kg } from '../../../common/decimal.js';

/**
 * Scale verification (ARCHITECTURE.md §9.1 "Scale verification", [MANUAL: daily]).
 *   PASS if |reading − standard| ≤ scale.verificationToleranceKg.
 *   While the tolerance is UNSET the verifier records PASS/FAIL explicitly.
 */
export type CheckResult = 'PASS' | 'FAIL';

export interface CalibrationInput {
  standardWeightKg: string;
  readingKg: string;
  /** scale.verificationToleranceKg (null = UNSET). */
  toleranceKg: number | null;
  /** Required when the tolerance is UNSET; ignored otherwise (the rule decides). */
  manualResult?: CheckResult;
}

export function evaluateCalibration(i: CalibrationInput): { deviationKg: string; result: CheckResult; resultSource: 'TOLERANCE' | 'MANUAL' } {
  const deviation = new Decimal(i.readingKg).minus(i.standardWeightKg);
  if (i.toleranceKg === null) {
    if (!i.manualResult) {
      throw new BusinessRuleError(
        'CALIBRATION_RESULT_REQUIRED',
        'No verification tolerance is configured (scale.verificationToleranceKg): record PASS or FAIL explicitly',
      );
    }
    return { deviationKg: kg(deviation), result: i.manualResult, resultSource: 'MANUAL' };
  }
  return { deviationKg: kg(deviation), result: deviation.abs().lte(i.toleranceKg) ? 'PASS' : 'FAIL', resultSource: 'TOLERANCE' };
}

export type UnverifiedReason = 'OUT_OF_SERVICE' | 'NEVER_VERIFIED' | 'LAST_CHECK_FAILED' | 'EXPIRED';

export interface ScaleVerificationState {
  verified: boolean;
  reason?: UnverifiedReason;
  /** When the current verification stops being valid (null when not verified). */
  validUntil: Date | null;
}

/**
 * Is a scale verified at instant `at`? `latest` = the most recent verification
 * or calibration taken at or before `at`.
 */
export function scaleVerificationAt(
  equipmentStatus: string,
  latest: { calibratedAt: Date; result: CheckResult } | null,
  at: Date,
  frequencyHours: number,
): ScaleVerificationState {
  if (equipmentStatus !== 'OPERATIONAL') return { verified: false, reason: 'OUT_OF_SERVICE', validUntil: null };
  if (!latest) return { verified: false, reason: 'NEVER_VERIFIED', validUntil: null };
  if (latest.result !== 'PASS') return { verified: false, reason: 'LAST_CHECK_FAILED', validUntil: null };
  const validUntil = new Date(latest.calibratedAt.getTime() + frequencyHours * 3_600_000);
  if (validUntil <= at) return { verified: false, reason: 'EXPIRED', validUntil: null };
  return { verified: true, validUntil };
}
