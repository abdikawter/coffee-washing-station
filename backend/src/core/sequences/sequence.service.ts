import type pg from 'pg';
import { zonedParts } from '../../common/util.js';
import type { SettingsService } from '../settings/settings.service.js';

const TOKEN_RE = /\{(YYYY|YY|MM|DD|YYMMDD|SEQ(\d))\}/g;

/** Which period a format restarts in: a daily token → per day, a year token → per year, else never. */
export function sequenceScope(format: string, parts: { year: string; month: string; day: string }): string {
  if (/\{(DD|YYMMDD)\}/.test(format)) return `${parts.year}${parts.month}${parts.day}`;
  if (/\{MM\}/.test(format)) return `${parts.year}${parts.month}`;
  if (/\{(YYYY|YY)\}/.test(format)) return parts.year;
  return 'ALL';
}

export function renderNumber(format: string, parts: { year: string; month: string; day: string }, seq: number): string {
  return format.replace(TOKEN_RE, (_m, token: string, width?: string) => {
    switch (token) {
      case 'YYYY': return parts.year;
      case 'YY': return parts.year.slice(2);
      case 'MM': return parts.month;
      case 'DD': return parts.day;
      case 'YYMMDD': return parts.year.slice(2) + parts.month + parts.day;
      default: return String(seq).padStart(Number(width), '0');
    }
  });
}

/**
 * Collision-free document numbers (ARCHITECTURE.md §2.2): an upsert on
 * document_sequences inside the caller's transaction. The row lock is held
 * until commit, so two concurrent vouchers never get the same number; a
 * rolled-back transaction releases its number (gap-tolerant).
 */
export class SequenceService {
  constructor(private readonly settings: SettingsService) {}

  async next(tx: pg.PoolClient, docType: string, at = new Date()): Promise<string> {
    const formats = await this.settings.getIn<Record<string, string>>(tx, 'numbering.formats');
    const format = formats[docType];
    if (!format) throw new Error(`No numbering format for ${docType}`);
    const tz = await this.settings.getIn<string>(tx, 'station.timezone');
    const parts = zonedParts(at, tz);
    const key = `${docType}:${sequenceScope(format, parts)}`;
    const { rows } = await tx.query<{ last_value: number }>(
      `INSERT INTO document_sequences (key, prefix, last_value) VALUES ($1, $2, 1)
       ON CONFLICT (key) DO UPDATE SET last_value = document_sequences.last_value + 1
       RETURNING last_value`,
      [key, docType],
    );
    return renderNumber(format, parts, rows[0]!.last_value);
  }
}
