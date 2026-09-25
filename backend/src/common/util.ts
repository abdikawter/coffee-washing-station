import { createHash, randomBytes } from 'node:crypto';

/** Deterministic JSON: object keys sorted recursively. Used for audit hash chaining. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortKeys(val);
    }
    return out;
  }
  return v;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Unguessable URL-safe token (refresh tokens, QR tokens). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

const DURATION_RE = /^(\d+)([smhd])$/;
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** "15m" → 900000. */
export function parseDurationMs(d: string): number {
  const m = DURATION_RE.exec(d);
  if (!m) throw new Error(`Invalid duration: ${d}`);
  return Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS];
}

/** Calendar parts of an instant in the station timezone. */
export function zonedParts(at: Date, timeZone: string): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** Business date "YYYY-MM-DD" of an instant in the station timezone (ARCHITECTURE.md §6.1). */
export function businessDate(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Removes secrets from values written to the audit log or logs. */
const SECRET_KEY = /(password|secret|token|hash)/i;
export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redact) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : redact(v);
    }
    return out as T;
  }
  return value;
}
