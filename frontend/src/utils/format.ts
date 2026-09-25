export const STATION_TIMEZONE = 'Africa/Addis_Ababa';

/** Timestamps arrive as ISO-8601 UTC; show them in the station timezone. */
export function formatDateTime(iso: string | null | undefined, timeZone = STATION_TIMEZONE): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
}

/** Setting values → short display text. */
export function formatSettingValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** "PURCHASING_CLERK" → "Purchasing clerk" */
export function humanize(code: string): string {
  const s = code.replace(/[_:.-]+/g, ' ').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
