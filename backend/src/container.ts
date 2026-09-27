import type pg from 'pg';
import type { Logger } from 'pino';
import type { Env } from './config/env.js';
import { AuditLogService } from './core/audit-log/audit-log.service.js';
import { CashLedgerService } from './core/cash-ledger/cash-ledger.service.js';
import { CorrectiveActionsService } from './core/corrective-actions/corrective-actions.service.js';
import { LotService } from './core/lots/lot.service.js';
import { OutboxService } from './core/outbox/outbox.service.js';
import { SequenceService } from './core/sequences/sequence.service.js';
import { SettingsService } from './core/settings/settings.service.js';
import { LocalStorageAdapter, S3StorageAdapter, type StorageAdapter } from './core/storage/storage.js';
import { RolesService } from './modules/access/roles.service.js';
import { AuthService } from './modules/auth/auth.service.js';
import { EquipmentService } from './modules/equipment/equipment.service.js';
import { ScalesService } from './modules/equipment/scales.service.js';
import { PaymentsService } from './modules/payments/payments.service.js';
import { PurchasingService } from './modules/purchasing/purchasing.service.js';
import { HoldsService } from './modules/quality/holds.service.js';
import { QualityService } from './modules/quality/quality.service.js';
import { SuppliersService } from './modules/suppliers/suppliers.service.js';
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
  cash: CashLedgerService;
  lots: LotService;
  correctiveActions: CorrectiveActionsService;
  auth: AuthService;
  users: UsersService;
  roles: RolesService;
  employees: EmployeesService;
  suppliers: SuppliersService;
  quality: QualityService;
  holds: HoldsService;
  equipment: EquipmentService;
  scales: ScalesService;
  purchasing: PurchasingService;
  payments: PaymentsService;
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
  const sequences = new SequenceService(settings);
  const outbox = new OutboxService();
  const cash = new CashLedgerService(sequences);
  const lots = new LotService(sequences, settings);
  const correctiveActions = new CorrectiveActionsService(sequences, settings, audit);
  const auth = new AuthService(pool, settings, audit, env.JWT_ACCESS_SECRET, env.JWT_ISSUER);
  const equipment = new EquipmentService(pool, audit);
  const scales = new ScalesService(pool, audit, settings, equipment, correctiveActions, outbox);
  const purchasing = new PurchasingService(pool, audit, settings, sequences, scales, lots, outbox);
  return {
    env,
    pool,
    logger,
    audit,
    settings,
    sequences,
    outbox,
    storage,
    cash,
    lots,
    correctiveActions,
    auth,
    users: new UsersService(pool, audit, auth),
    roles: new RolesService(pool, audit),
    employees: new EmployeesService(pool, audit),
    suppliers: new SuppliersService(pool, audit),
    quality: new QualityService(pool, audit, settings, sequences),
    holds: new HoldsService(pool, audit, lots, outbox),
    equipment,
    scales,
    purchasing,
    payments: new PaymentsService(pool, audit, settings, sequences, cash, purchasing, lots, outbox),
  };
}
