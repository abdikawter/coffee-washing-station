import type pg from 'pg';
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError, StaleVersionError, ValidationError } from '../../common/errors.js';
import { camelize } from '../../db/pool.js';
import type { AuthUser, RequestMeta } from '../../http/types.js';
import type { AuditLogService } from '../audit-log/audit-log.service.js';
import { SETTING_PAIRS, SETTINGS, SETTINGS_BY_KEY, SYSTEM_CATEGORIES, type SettingSource } from './registry.js';

export interface SettingRow {
  id: string;
  key: string;
  category: string;
  value: unknown;
  valueType: string;
  description: string;
  source: SettingSource;
  version: number;
  updatedById: string | null;
  updatedAt: Date;
  createdAt: Date;
}

const CACHE_TTL_MS = 5_000;

/**
 * Typed access to system_settings (ARCHITECTURE.md §2.2, §20).
 * - Reads inside a transaction go to the DB (`getIn(tx, key)`) so a business
 *   rule sees one consistent snapshot, which callers then store on the record.
 * - Reads outside a transaction use a 5-second in-process cache (no Redis).
 * - Changes need a reason, are version-checked and audited with before/after.
 */
export class SettingsService {
  private cache = new Map<string, { value: unknown; at: number }>();

  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditLogService,
  ) {}

  /** Inserts registry keys that do not exist yet. Never overwrites values. */
  async seedDefaults(tx: pg.PoolClient): Promise<number> {
    let inserted = 0;
    for (const s of SETTINGS) {
      const r = await tx.query(
        `INSERT INTO system_settings (key, category, value, value_type, description, source)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (key) DO NOTHING`,
        [s.key, s.category, JSON.stringify(s.defaultValue), s.valueType, s.description, s.source],
      );
      inserted += r.rowCount ?? 0;
    }
    return inserted;
  }

  async get<T>(key: string): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
    const value = await this.getIn<T>(this.pool, key);
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  async getIn<T>(db: pg.Pool | pg.PoolClient, key: string): Promise<T> {
    const { rows } = await db.query('SELECT value FROM system_settings WHERE key = $1', [key]);
    if (rows.length === 0) {
      const def = SETTINGS_BY_KEY.get(key);
      if (!def) throw new Error(`Unknown setting ${key}`);
      return def.defaultValue as T; // not seeded yet: registry default
    }
    return rows[0].value as T;
  }

  /** For rules that cannot run without a configured value (ARCHITECTURE.md §11.1). */
  async require<T>(db: pg.Pool | pg.PoolClient, key: string): Promise<T> {
    const v = await this.getIn<T | null>(db, key);
    if (v === null || v === undefined) {
      throw new BusinessRuleError('SETTING_NOT_CONFIGURED', `Setting "${key}" must be configured before this action`, { key });
    }
    return v;
  }

  invalidate(key?: string): void {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }

  async list(filter: { category?: string; unconfirmedOnly?: boolean } = {}): Promise<SettingRow[]> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.category) {
      args.push(filter.category);
      where.push(`category = $${args.length}`);
    }
    if (filter.unconfirmedOnly) where.push(`source IN ('PROVISIONAL', 'UNSET')`);
    const { rows } = await this.pool.query(
      `SELECT * FROM system_settings ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY category, key`,
      args,
    );
    return rows.map((r) => camelize<SettingRow>(r));
  }

  async getRow(key: string): Promise<SettingRow> {
    const { rows } = await this.pool.query('SELECT * FROM system_settings WHERE key = $1', [key]);
    if (!rows[0]) throw new NotFoundError('Setting', key);
    return camelize<SettingRow>(rows[0]);
  }

  static canManage(user: AuthUser, category: string): boolean {
    return SYSTEM_CATEGORIES.has(category)
      ? user.permissions.has('settings:manage-system')
      : user.permissions.has('settings:manage') || user.permissions.has('settings:manage-system');
  }

  /**
   * Changes a value (source becomes CONFIRMED) or confirms the current value
   * when `value` is omitted.
   */
  async update(
    tx: pg.PoolClient,
    user: AuthUser,
    key: string,
    input: { value?: unknown; version: number; reason: string },
    meta: RequestMeta,
  ): Promise<SettingRow> {
    const def = SETTINGS_BY_KEY.get(key);
    const { rows } = await tx.query('SELECT * FROM system_settings WHERE key = $1 FOR UPDATE', [key]);
    if (!rows[0] || !def) throw new NotFoundError('Setting', key);
    const before = camelize<SettingRow>(rows[0]);
    if (!SettingsService.canManage(user, before.category)) {
      throw new ForbiddenError(
        SYSTEM_CATEGORIES.has(before.category)
          ? 'System settings can only be changed by a system administrator'
          : 'You cannot change this setting',
        'FORBIDDEN',
        { required: SYSTEM_CATEGORIES.has(before.category) ? 'settings:manage-system' : 'settings:manage' },
      );
    }
    if (before.version !== input.version) throw new StaleVersionError('Setting');

    const confirming = input.value === undefined;
    let newValue = before.value;
    if (!confirming) {
      const parsed = def.schema.safeParse(input.value);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => ({ location: 'body', path: ['value', ...i.path].join('.'), message: i.message })));
      }
      newValue = parsed.data;
    } else if (before.value === null) {
      throw new BusinessRuleError('SETTING_VALUE_REQUIRED', 'An UNSET setting must be given a value, not just confirmed', { key });
    }

    for (const pair of SETTING_PAIRS) {
      if (key !== pair.min && key !== pair.max) continue;
      const otherKey = key === pair.min ? pair.max : pair.min;
      const other = await this.getIn<number | null>(tx, otherKey);
      const min = key === pair.min ? (newValue as number) : other;
      const max = key === pair.max ? (newValue as number) : other;
      if (min != null && max != null && min > max) {
        throw new BusinessRuleError('SETTING_RANGE_INVALID', `${pair.min} must not exceed ${pair.max}`, { min, max });
      }
    }

    const upd = await tx.query(
      `UPDATE system_settings SET value = $1, source = 'CONFIRMED', version = version + 1, updated_by_id = $2
        WHERE key = $3 AND version = $4 RETURNING *`,
      [JSON.stringify(newValue), user.id, key, input.version],
    );
    if (upd.rowCount !== 1) throw new ConflictError('Setting changed concurrently', 'STALE_VERSION');
    const after = camelize<SettingRow>(upd.rows[0]);
    await this.audit.record(tx, {
      userId: user.id,
      action: 'SETTING_CHANGE',
      module: 'settings',
      entityType: 'SystemSetting',
      entityId: after.id,
      previousValue: { key, value: before.value, source: before.source, version: before.version },
      newValue: { key, value: after.value, source: after.source, version: after.version, reason: input.reason, confirmedOnly: confirming },
      meta,
    });
    this.invalidate(key);
    return after;
  }
}
