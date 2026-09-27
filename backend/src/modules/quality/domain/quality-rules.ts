import { Decimal } from '../../../common/decimal.js';

/**
 * Cherry quality evaluation (ARCHITECTURE.md §9.1 "Quality inspection").
 * Pure functions: no Express, no pg.
 */
export type QualityMetric = 'RED_RIPE_PCT' | 'GREEN_UNRIPE_PCT' | 'OVERRIPE_DAMAGED_PCT';
export type ComparisonOperator = 'LT' | 'LTE' | 'GT' | 'GTE';
export type RuleAction = 'REJECT' | 'WARN';

export interface QualityRule {
  id: string;
  name: string;
  metric: QualityMetric;
  operator: ComparisonOperator;
  threshold: string;
  action: RuleAction;
}

export interface CherryPercentages {
  redRipePct: string;
  greenUnripePct: string;
  overripeDamagedPct: string;
}

export interface RuleResult {
  ruleId: string;
  name: string;
  metric: QualityMetric;
  operator: ComparisonOperator;
  threshold: string;
  action: RuleAction;
  value: string;
  triggered: boolean;
}

export interface QualityEvaluation {
  /** REJECT when any REJECT rule triggered, WARN when only WARN rules did, else PASS. */
  outcome: 'PASS' | 'WARN' | 'REJECT';
  percentSum: string;
  results: RuleResult[];
}

const METRIC_FIELD: Record<QualityMetric, keyof CherryPercentages> = {
  RED_RIPE_PCT: 'redRipePct',
  GREEN_UNRIPE_PCT: 'greenUnripePct',
  OVERRIPE_DAMAGED_PCT: 'overripeDamagedPct',
};

export function percentSum(p: CherryPercentages): string {
  return new Decimal(p.redRipePct).plus(p.greenUnripePct).plus(p.overripeDamagedPct).toFixed(2);
}

/** Red + green + overripe must be within `tolerance` of 100 (setting quality.percentSumTolerance). */
export function percentSumWithinTolerance(p: CherryPercentages, tolerance: number): boolean {
  return new Decimal(percentSum(p)).minus(100).abs().lte(tolerance);
}

export function ruleTriggered(rule: Pick<QualityRule, 'operator' | 'threshold'>, value: string): boolean {
  const v = new Decimal(value);
  switch (rule.operator) {
    case 'LT': return v.lt(rule.threshold);
    case 'LTE': return v.lte(rule.threshold);
    case 'GT': return v.gt(rule.threshold);
    case 'GTE': return v.gte(rule.threshold);
  }
}

/** Evaluates every active rule; the result is snapshotted on the inspection. */
export function evaluateQualityRules(rules: QualityRule[], p: CherryPercentages): QualityEvaluation {
  const results = rules.map((r): RuleResult => {
    const value = new Decimal(p[METRIC_FIELD[r.metric]]).toFixed(2);
    return {
      ruleId: r.id, name: r.name, metric: r.metric, operator: r.operator,
      threshold: new Decimal(r.threshold).toFixed(2), action: r.action, value, triggered: ruleTriggered(r, value),
    };
  });
  const fired = results.filter((r) => r.triggered);
  const outcome = fired.some((r) => r.action === 'REJECT') ? 'REJECT' : fired.length ? 'WARN' : 'PASS';
  return { outcome, percentSum: percentSum(p), results };
}
