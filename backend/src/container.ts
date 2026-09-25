import type pg from 'pg';
import type { Logger } from 'pino';
import type { Env } from './config/env.js';
import { AuditLogService } from './core/audit-log/audit-log.service.js';
import { OutboxService } from './core/outbox/outbox.service.js';
import { SequenceService } from './core/sequences/sequence.service.js';
import { SettingsService } from './core/settings/settings.service.js';
import { LocalStorageAdapter, S3StorageAdapter, type StorageAdapter } from './core/storage/storage.js';
import { RolesService } from './modules/access/roles.service.js';
import { AuthService } from './modules/auth/auth.service.js';
import { EmployeesService } from './modules/users/employees.service.js';
import { UsersService } from './modules/users/users.service.js';

/** Plain constructor wiring — no DI framework. Shared by the API and the worker. */
export interface Container {
  env: Env;
  pool: pg.Pool;
  logger: Logger;
  audit: AuditLogService;
  settings: SettingsService;
  sequences: SequenceService;
  outbox: OutboxService;
  storage: StorageAdapter;
  auth: AuthService;
  users: UsersService;
  roles: RolesService;
  employees: EmployeesService;
}

export function createStorage(env: Env): StorageAdapter {
  if (env.STORAGE_DRIVER === 's3') {
    return new S3StorageAdapter({
      bucket: env.S3_BUCKET!,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  return new LocalStorageAdapter(env.LOCAL_STORAGE_DIR);
}

export function createContainer(env: Env, pool: pg.Pool, logger: Logger, storage: StorageAdapter = createStorage(env)): Container {
  const audit = new AuditLogService();
  const settings = new SettingsService(pool, audit);
  const auth = new AuthService(pool, settings, audit, env.JWT_ACCESS_SECRET, env.JWT_ISSUER);
  return {
    env,
    pool,
    logger,
    audit,
    settings,
    sequences: new SequenceService(settings),
    outbox: new OutboxService(),
    storage,
    auth,
    users: new UsersService(pool, audit, auth),
    roles: new RolesService(pool, audit),
    employees: new EmployeesService(pool, audit),
  };
}
