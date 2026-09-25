import type pg from 'pg';
import { z } from 'zod';
import { SETTINGS_BY_KEY, SYSTEM_CATEGORIES } from '../../core/settings/registry.js';
import { SettingsService } from '../../core/settings/settings.service.js';
import { withTransaction } from '../../db/pool.js';
import type { Api } from '../../http/api.js';
import { single } from '../../http/schemas.js';

const settingSchema = z
  .object({
    key: z.string(),
    category: z.string(),
    value: z.unknown(),
    valueType: z.enum(['NUMBER', 'STRING', 'BOOLEAN', 'ENUM', 'JSON']),
    description: z.string(),
    source: z.enum(['MANUAL', 'PROVISIONAL', 'UNSET', 'CONFIRMED']),
    options: z.array(z.string()).nullable(),
    isSystem: z.boolean(),
    version: z.number().int(),
    updatedById: z.uuid().nullable(),
    updatedAt: z.date(),
  })
  .meta({ id: 'Setting' });

function present(row: Awaited<ReturnType<SettingsService['getRow']>>) {
  return {
    key: row.key,
    category: row.category,
    value: row.value,
    valueType: row.valueType,
    description: row.description,
    source: row.source,
    options: SETTINGS_BY_KEY.get(row.key)?.options ? [...SETTINGS_BY_KEY.get(row.key)!.options!] : null,
    isSystem: SYSTEM_CATEGORIES.has(row.category),
    version: row.version,
    updatedById: row.updatedById,
    updatedAt: row.updatedAt,
  };
}

const keyParam = z.object({ key: z.string().regex(/^[a-zA-Z]+\.[a-zA-Z]+$/) }).strict();

export function registerSettingsRoutes(api: Api, pool: pg.Pool, settings: SettingsService): void {
  api.route('Settings', {
    method: 'get', path: '/settings', summary: 'List settings',
    access: { permission: 'settings:read' },
    query: z.object({ category: z.string().max(50).optional() }).strict(),
    response: { status: 200, description: 'Settings', schema: single(z.array(settingSchema)) },
    handler: async ({ query }) => ({ data: (await settings.list({ category: query.category })).map(present) }),
  });

  api.route('Settings', {
    method: 'get', path: '/settings/unconfirmed', summary: 'Settings still PROVISIONAL or UNSET (the "settings to confirm" banner)',
    access: { permission: 'settings:read' },
    response: { status: 200, description: 'Unconfirmed settings', schema: single(z.array(settingSchema)) },
    handler: async () => ({ data: (await settings.list({ unconfirmedOnly: true })).map(present) }),
  });

  api.route('Settings', {
    method: 'get', path: '/settings/:key', summary: 'Get one setting',
    access: { permission: 'settings:read' }, params: keyParam,
    response: { status: 200, description: 'Setting', schema: single(settingSchema) },
    handler: async ({ params }) => ({ data: present(await settings.getRow(params.key)) }),
  });

  api.route('Settings', {
    method: 'put', path: '/settings/:key', summary: 'Change or confirm a setting',
    description:
      'Send `value` to change it, or omit `value` to confirm the current one. Reason is mandatory and audited with before/after. ' +
      'Business keys need `settings:manage`; system categories (auth, numbering, notifications, station) need `settings:manage-system`.',
    access: { permission: ['settings:manage', 'settings:manage-system'] }, params: keyParam,
    body: z.object({ value: z.unknown().optional(), version: z.number().int().min(1), reason: z.string().trim().min(3).max(500) }).strict(),
    response: { status: 200, description: 'Updated setting', schema: single(settingSchema) },
    handler: async ({ params, body, user, meta }) =>
      ({ data: present(await withTransaction(pool, (tx) => settings.update(tx, user, params.key, body, meta))) }),
  });
}
