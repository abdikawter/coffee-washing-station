import { Decimal as DecimalJs } from 'decimal.js';

/**
 * Decimal arithmetic for money and weights (ARCHITECTURE.md §2.4). JS `number`
 * is never used for business quantities; values travel as strings.
 */
export const Decimal = DecimalJs.clone({ precision: 40 });
export type Decimal = InstanceType<typeof Decimal>;

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN';
const MODES: Record<RoundingMode, DecimalJs.Rounding> = {
  HALF_UP: DecimalJs.ROUND_HALF_UP,
  HALF_EVEN: DecimalJs.ROUND_HALF_EVEN,
  DOWN: DecimalJs.ROUND_DOWN,
};

export const MONEY_DP = 2;
export const WEIGHT_DP = 3;
export const PERCENT_DP = 2;

export function dec(v: DecimalJs.Value): Decimal {
  return new Decimal(v);
}

export function roundTo(v: DecimalJs.Value, dp: number, mode: RoundingMode = 'HALF_UP'): string {
  return new Decimal(v).toDecimalPlaces(dp, MODES[mode]).toFixed(dp);
}

export const money = (v: DecimalJs.Value, mode?: RoundingMode) => roundTo(v, MONEY_DP, mode);
export const kg = (v: DecimalJs.Value, mode?: RoundingMode) => roundTo(v, WEIGHT_DP, mode);

/** amount = weightKg × pricePerKg, rounded to money (ARCHITECTURE.md §11.2 [MANUAL]). */
export function lineAmount(weightKg: string, pricePerKg: string, mode?: RoundingMode): string {
  return money(new Decimal(weightKg).times(pricePerKg), mode);
}

/** Σ of decimal strings, exact. */
export function sum(values: DecimalJs.Value[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0));
}

/** Decimal-string validator for request bodies: up to `dp` decimals, non-negative unless allowed. */
export function decimalPattern(dp: number, allowNegative = false): RegExp {
  return new RegExp(`^${allowNegative ? '-?' : ''}\\d{1,12}(\\.\\d{1,${dp}})?$`);
}
