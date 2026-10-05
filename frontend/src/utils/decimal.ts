/**
 * Exact decimal-string arithmetic for on-screen previews (BigInt fixed point).
 * Business values are always computed by the server; the UI only previews them
 * and never parses them into floats (ARCHITECTURE.md §3).
 */
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export function isDecimal(s: string, maxDp = 3): boolean {
  return DECIMAL_RE.test(s.trim()) && (s.split('.')[1]?.length ?? 0) <= maxDp;
}

function toScaled(s: string, dp: number): bigint {
  const [int = '0', frac = ''] = s.trim().replace(/^-/, '').split('.');
  const v = BigInt(int + frac.padEnd(dp, '0').slice(0, dp));
  return s.trim().startsWith('-') ? -v : v;
}

function fromScaled(v: bigint, dp: number): string {
  const neg = v < 0n;
  const abs = (neg ? -v : v).toString().padStart(dp + 1, '0');
  const out = dp ? `${abs.slice(0, -dp)}.${abs.slice(-dp)}` : abs;
  return neg ? `-${out}` : out;
}

/** a − b with `dp` decimals (e.g. net = gross − tare, dp 3). */
export function subtract(a: string, b: string, dp = 3): string {
  return fromScaled(toScaled(a, dp) - toScaled(b, dp), dp);
}

/** -1, 0 or 1 as a is less than, equal to or greater than b (exact, at `dp` places). */
export function compare(a: string, b: string, dp = 3): -1 | 0 | 1 {
  const d = toScaled(a, dp) - toScaled(b, dp);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

export function add(values: string[], dp = 3): string {
  return fromScaled(values.reduce((acc, v) => acc + toScaled(v, dp), 0n), dp);
}

/** weight (3 dp) × price (2 dp) rounded half-up to 2 dp — same rule as the server default. */
export function multiplyMoney(weightKg: string, price: string): string {
  const product = toScaled(weightKg, 3) * toScaled(price, 2); // scale 10^5
  const neg = product < 0n;
  const abs = neg ? -product : product;
  const rounded = (abs + 500n) / 1000n; // to scale 10^2, half up
  return fromScaled(neg ? -rounded : rounded, 2);
}

/**
 * Change of `current` vs `previous` in percent, 1 dp, rounded half away from zero
 * ("-12.5"). Null when there is no previous value to compare with.
 */
export function percentChange(current: string, previous: string): string | null {
  const p = toScaled(previous, 3);
  if (p === 0n) return null;
  const diff = (toScaled(current, 3) - p) * 1000n; // × 100 (percent) × 10 (1 dp)
  const neg = (diff < 0n) !== (p < 0n);
  const [n, d] = [diff < 0n ? -diff : diff, p < 0n ? -p : p];
  const rounded = (n * 2n + d) / (2n * d);
  return fromScaled(neg ? -rounded : rounded, 1);
}

/** "12345.5" → "12,345.50" for display. */
export function formatNumber(value: string | null | undefined, dp = 2): string {
  if (value === null || value === undefined || value === '') return '—';
  if (!DECIMAL_RE.test(value)) return value;
  // Round half away from zero to `dp` places (e.g. 950.5 → 951 at dp 0) instead of cutting digits off.
  const extra = Math.max(0, (value.split('.')[1]?.length ?? 0) - dp);
  const full = toScaled(value, dp + extra);
  const unit = 10n ** BigInt(extra);
  const abs = full < 0n ? -full : full;
  const rounded = extra ? (abs + unit / 2n) / unit : abs;
  const fixed = fromScaled(full < 0n ? -rounded : rounded, dp);
  const [int, frac] = fixed.split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}
