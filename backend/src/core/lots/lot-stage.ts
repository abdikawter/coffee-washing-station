import { BusinessRuleError } from '../../common/errors.js';

/**
 * Lot stage machine (ARCHITECTURE.md §9.2):
 *   PURCHASED → HOPPER → FLOTATION → PULPING → FERMENTATION → WASHING → GRADING
 *   → (grade child lot) DRYING → FINAL_MOISTURE_VERIFIED → WAREHOUSE → RELEASED
 * Stages only move forward, one step at a time, through LotService.advance().
 */
export const LOT_STAGES = [
  'PURCHASED', 'HOPPER', 'FLOTATION', 'PULPING', 'FERMENTATION', 'WASHING', 'GRADING',
  'DRYING', 'FINAL_MOISTURE_VERIFIED', 'WAREHOUSE', 'RELEASED',
] as const;
export type LotStage = (typeof LOT_STAGES)[number];

/** Stages handled by wet processing (Phase 3). */
export const WET_STAGES = ['PURCHASED', 'HOPPER', 'FLOTATION', 'PULPING', 'FERMENTATION', 'WASHING', 'GRADING'] as const satisfies readonly LotStage[];

export const LOT_STATUSES = ['ACTIVE', 'ON_HOLD', 'SPLIT', 'IN_STORE', 'RELEASED', 'REJECTED', 'CLOSED'] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

export function nextStage(stage: LotStage): LotStage | null {
  const i = LOT_STAGES.indexOf(stage);
  return LOT_STAGES[i + 1] ?? null;
}

export function canAdvance(from: LotStage, to: LotStage): boolean {
  return nextStage(from) === to;
}

/** Throws 422 LOT_STAGE_INVALID unless `to` is the stage right after `from`. */
export function assertStageTransition(from: LotStage, to: LotStage): void {
  if (!canAdvance(from, to)) {
    throw new BusinessRuleError('LOT_STAGE_INVALID', `A lot at ${from} cannot move to ${to}`, { currentStage: from, requestedStage: to, expectedNext: nextStage(from) });
  }
}

/** A lot can move forward only while ACTIVE (not on hold, split, closed, rejected, in store). */
export function assertLotMovable(status: LotStatus): void {
  if (status !== 'ACTIVE') {
    throw new BusinessRuleError(status === 'ON_HOLD' ? 'LOT_ON_HOLD' : 'LOT_NOT_ACTIVE', `The lot is ${status} and cannot be processed`, { status });
  }
}
