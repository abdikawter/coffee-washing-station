import type pg from 'pg';
import { BusinessRuleError, NotFoundError } from '../../common/errors.js';
import type { AuditLogService } from '../../core/audit-log/audit-log.service.js';
import { camelize, camelizeRows, withTransaction } from '../../db/pool.js';
import { Where } from '../../db/where.js';
import { orderBy, pageClause, type PageQuery } from '../../http/schemas.js';
import type { AuthUser, RequestMeta } from '../../http/types.js';

export const EQUIPMENT_TYPES = ['SCALE', 'HOPPER', 'PULPING_MACHINE', 'FERMENTATION_TANK', 'MOISTURE_METER', 'OTHER'] as const;
export const EQUIPMENT_STATUSES = ['OPERATIONAL', 'UNDER_MAINTENANCE', 'OUT_OF_SERVICE', 'DECOMMISSIONED'] as const;
export const MAINTENANCE_TYPES = ['INSPECTION', 'CLEANING', 'CALIBRATION', 'PREVENTIVE', 'REPAIR'] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];
export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];

export interface EquipmentInput {
  code: string;
  name: string;
  type: EquipmentType;
  location?: string | null;
  serialNo?: string | null;
  responsibleEmployeeId?: string | null;
}

const SORT = { code: 'e.code', name: 'e.name', type: 'e.type', createdAt: 'e.created_at' };
const EQUIPMENT_SELECT = `
  SELECT e.*, emp.full_name AS responsible_employee_name,
         (SELECT min(ms.next_due_at) FROM maintenance_schedules ms WHERE ms.equipment_id = e.id AND ms.is_active) AS next_maintenance_due_at
    FROM equipment e LEFT JOIN employees emp ON emp.id = e.responsible_employee_id`;

/** Equipment register, maintenance records and schedules (ARCHITECTURE.md §4 module 9). */
export class EquipmentService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditLogService,
  ) {}

  async list(q: PageQuery & { type?: EquipmentType; status?: EquipmentStatus; search?: string }) {
    const w = new Where()
      .addIf(q.type, 'e.type = ?')
      .addIf(q.status, 'e.status = ?')
      .addIf(q.search, '(e.code ILIKE ? OR e.name ILIKE ?)', q.search && `%${q.search}%`);
    const { limit, offset } = pageClause(q);
    const [rows, count] = await Promise.all([
      this.pool.query(`${EQUIPMENT_SELECT} ${w.sql} ORDER BY ${orderBy(q.sort, SORT)}, e.id LIMIT ${limit} OFFSET ${offset}`, w.args),
      this.pool.query(`SELECT count(*)::int AS n FROM equipment e ${w.sql}`, w.args),
    ]);
    return { data: camelizeRows(rows.rows), total: count.rows[0].n as number };
  }

  async get(id: string, db: pg.Pool | pg.PoolClient = this.pool) {
    const { rows } = await db.query(`${EQUIPMENT_SELECT} WHERE e.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundError('Equipment', id);
    return camelize<{ id: string; type: EquipmentType; status: EquipmentStatus } & Record<string, unknown>>(rows[0]);
  }

  /** Inserts the equipment row; used by `create` and by ScalesService (type SCALE). */
  async insert(tx: pg.PoolClient, input: EquipmentInput): Promise<string> {
    const { rows } = await tx.query(
      `INSERT INTO equipment (code, name, type, location, serial_no, responsible_employee_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [input.code.trim().toUpperCase(), input.name.trim(), input.type, input.location ?? null, input.serialNo ?? null, input.responsibleEmployeeId ?? null],
    );
    return rows[0].id;
  }

  async create(actor: AuthUser, input: EquipmentInput, meta: RequestMeta) {
    if (input.type === 'SCALE') throw new BusinessRuleError('USE_SCALES_ENDPOINT', 'Register scales with POST /scales (capacity and verification data)');
    return withTransaction(this.pool, async (tx) => {
      const id = await this.insert(tx, input);
      const created = await this.get(id, tx);
      await this.audit.record(tx, { userId: actor.id, action: 'CREATE', module: 'equipment', entityType: 'Equipment', entityId: id, newValue: created, meta });
      return created;
    });
  }

  async update(
    actor: AuthUser, id: string,
    input: { name?: string; location?: string | null; serialNo?: string | null; responsibleEmployeeId?: string | null; status?: EquipmentStatus; reason?: string },
    meta: RequestMeta,
  ) {
    return withTransaction(this.pool, async (tx) => {
      const { rows: cur } = await tx.query('SELECT * FROM equipment WHERE id = $1 FOR UPDATE', [id]);
      if (!cur[0]) throw new NotFoundError('Equipment', id);
      const b = camelize<Record<string, unknown>>(cur[0]);
      if (b.status === 'DECOMMISSIONED' && input.status && input.status !== 'DECOMMISSIONED') {
        throw new BusinessRuleError('EQUIPMENT_DECOMMISSIONED', 'Decommissioned equipment cannot be put back into service');
      }
      const n = { ...b, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
      await tx.query(
        `UPDATE equipment SET name = $2, location = $3, serial_no = $4, responsible_employee_id = $5, status = $6 WHERE id = $1`,
        [id, n.name, n.location, n.serialNo, n.responsibleEmployeeId, n.status],
      );
      const after = await this.get(id, tx);
      await this.audit.record(tx, {
        userId: actor.id, action: 'UPDATE', module: 'equipment', entityType: 'Equipment', entityId: id,
        previousValue: b, newValue: { ...after, reason: input.reason }, meta,
      });
      return after;
    });
  }

  // ------------------------------------------------------------------ maintenance

  async listMaintenance(equipmentId: string) {
    await this.get(equipmentId);
    const { rows } = await this.pool.query(
      `SELECT m.*, u.full_name AS performed_by_name FROM machine_maintenance m JOIN users u ON u.id = m.performed_by_id
        WHERE m.equipment_id = $1 ORDER BY m.performed_at DESC LIMIT 200`,
      [equipmentId],
    );
    return camelizeRows(rows);
  }

  /** Records maintenance performed; advances the matching active schedule. */
  async recordMaintenance(
    actor: AuthUser, equipmentId: string,
    input: { type: MaintenanceType; performedAt: Date; description: string; result?: 'PASS' | 'FAIL' | null; cost?: string | null; nextDueAt?: Date | null },
    meta: RequestMeta,
  ) {
    return withTransaction(this.pool, async (tx) => {
      await this.get(equipmentId, tx);
      const { rows } = await tx.query(
        `INSERT INTO machine_maintenance (equipment_id, type, performed_at, performed_by_id, description, result, cost, next_due_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [equipmentId, input.type, input.performedAt, actor.id, input.description, input.result ?? null, input.cost ?? null, input.nextDueAt ?? null],
      );
      await tx.query(
        `UPDATE maintenance_schedules
            SET last_performed_at = $3::timestamptz, next_due_at = COALESCE($4::timestamptz, $3::timestamptz + make_interval(days => interval_days))
          WHERE equipment_id = $1 AND type = $2 AND is_active`,
        [equipmentId, input.type, input.performedAt, input.nextDueAt ?? null],
      );
      const created = camelize(rows[0]);
      await this.audit.record(tx, { userId: actor.id, action: 'CREATE', module: 'equipment', entityType: 'MachineMaintenance', entityId: rows[0].id, newValue: created, meta });
      return created;
    });
  }

  async listSchedules(equipmentId: string) {
    await this.get(equipmentId);
    const { rows } = await this.pool.query('SELECT * FROM maintenance_schedules WHERE equipment_id = $1 ORDER BY is_active DESC, next_due_at', [equipmentId]);
    return camelizeRows(rows);
  }

  async createSchedule(
    actor: AuthUser, equipmentId: string,
    input: { type: MaintenanceType; intervalDays: number; nextDueAt?: Date | null; responsibleEmployeeId?: string | null },
    meta: RequestMeta,
  ) {
    return withTransaction(this.pool, async (tx) => {
      await this.get(equipmentId, tx);
      const { rows } = await tx.query(
        `INSERT INTO maintenance_schedules (equipment_id, type, interval_days, next_due_at, responsible_employee_id)
         VALUES ($1,$2,$3,COALESCE($4::timestamptz, now() + make_interval(days => $3::int)),$5) RETURNING *`,
        [equipmentId, input.type, input.intervalDays, input.nextDueAt ?? null, input.responsibleEmployeeId ?? null],
      );
      const created = camelize(rows[0]);
      await this.audit.record(tx, { userId: actor.id, action: 'CREATE', module: 'equipment', entityType: 'MaintenanceSchedule', entityId: rows[0].id, newValue: created, meta });
      return created;
    });
  }

  async updateSchedule(
    actor: AuthUser, scheduleId: string,
    input: { intervalDays?: number; nextDueAt?: Date; responsibleEmployeeId?: string | null; isActive?: boolean },
    meta: RequestMeta,
  ) {
    return withTransaction(this.pool, async (tx) => {
      const { rows: cur } = await tx.query('SELECT * FROM maintenance_schedules WHERE id = $1 FOR UPDATE', [scheduleId]);
      if (!cur[0]) throw new NotFoundError('Maintenance schedule', scheduleId);
      const b = camelize<Record<string, unknown>>(cur[0]);
      const n = { ...b, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
      const { rows } = await tx.query(
        `UPDATE maintenance_schedules SET interval_days = $2, next_due_at = $3, responsible_employee_id = $4, is_active = $5 WHERE id = $1 RETURNING *`,
        [scheduleId, n.intervalDays, n.nextDueAt, n.responsibleEmployeeId, n.isActive],
      );
      const after = camelize(rows[0]);
      await this.audit.record(tx, { userId: actor.id, action: 'UPDATE', module: 'equipment', entityType: 'MaintenanceSchedule', entityId: scheduleId, previousValue: b, newValue: after, meta });
      return after;
    });
  }
}
