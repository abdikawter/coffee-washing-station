import { BusinessRuleError } from '../../../common/errors.js';
import { Decimal, kg, lineAmount, money, sum, type RoundingMode } from '../../../common/decimal.js';

/**
 * Purchase totals (ARCHITECTURE.md §11.2, [MANUAL]):
 *   net = gross − tare;  line weight = Σ net;  amount = weight × price/kg;
 *   voucher total weight = Σ line weights;  total amount = Σ amounts.
 * Client-supplied totals are never used: the server computes everything here.
 */
export interface WeighingInput {
  grossKg: string;
  tareKg: string;
}

export interface ItemInput {
  pricePerKg: string;
  weighings: WeighingInput[];
}

export interface ComputedWeighing {
  grossKg: string;
  tareKg: string;
  netKg: string;
}

export interface ComputedItem {
  lineNo: number;
  weightKg: string;
  pricePerKg: string;
  amount: string;
  weighings: ComputedWeighing[];
}

export interface ComputedVoucher {
  items: ComputedItem[];
  totalWeightKg: string;
  totalAmount: string;
}

export function netWeight(w: WeighingInput): string {
  const gross = new Decimal(w.grossKg);
  const tare = new Decimal(w.tareKg);
  if (gross.lte(0)) throw new BusinessRuleError('INVALID_WEIGHT', 'Gross weight must be greater than zero', w);
  if (tare.lt(0) || tare.gte(gross)) throw new BusinessRuleError('INVALID_WEIGHT', 'Tare must be at least zero and less than the gross weight', w);
  return kg(gross.minus(tare));
}

export function computeVoucher(items: ItemInput[], mode: RoundingMode = 'HALF_UP'): ComputedVoucher {
  if (items.length === 0) throw new BusinessRuleError('NO_ITEMS', 'A voucher needs at least one item');
  const computed = items.map((item, i): ComputedItem => {
    if (item.weighings.length === 0) throw new BusinessRuleError('NO_WEIGHINGS', `Item ${i + 1} has no weight records`);
    const weighings = item.weighings.map((w) => ({ grossKg: kg(w.grossKg), tareKg: kg(w.tareKg), netKg: netWeight(w) }));
    const weightKg = kg(sum(weighings.map((w) => w.netKg)));
    return { lineNo: i + 1, weightKg, pricePerKg: money(item.pricePerKg), amount: lineAmount(weightKg, item.pricePerKg, mode), weighings };
  });
  return {
    items: computed,
    totalWeightKg: kg(sum(computed.map((c) => c.weightKg))),
    totalAmount: money(sum(computed.map((c) => c.amount))),
  };
}
