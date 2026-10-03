import type pg from 'pg';
import { BusinessRuleError, NotFoundError } from '../../common/errors.js';
import { kg } from '../../common/decimal.js';
import type { AuditLogService } from '../../core/audit-log/audit-log.service.js';
import { camelizeRows, withTransaction } from '../../db/pool.js';
import type { AuthUser, RequestMeta } from '../../http/types.js';
import type { EquipmentService } from '../equipment/equipment.service.js';

export type ProcessingUnit = 'hopper' | 'pulper' | 'tank';

const UNITS = {
  hopper: { table: 'hoppers', type: 'HOPPER', label: 'Hopper', capacity: true },
  pulper: { table: 'pulping_machines', type: 'PULPING_MACHINE', label: 'Pulping machine', capacity: false },
  tank: { table: 'fermentation_tanks', type: 'FERMENTATION_TANK', label: 'Fermentation tank', capacity: true },
} as const;

/** Unit + its equipment row, locked; throws unless the equipment is OPERATIONAL. */
export async function lockOperationalUnit(tx: pg.PoolClient, unit: ProcessingUnit, id: string) {
  const u = UNITS[unit];
  const { rows } = await tx.query(
    `SELECT x.*, e.code, e.name, e.status FROM ${u.table} x JOIN equipment e ON e.id = x.equipment_id WHERE x.id = $1 FOR SHARE OF x`,
    [id],
  );
  if (!rows[0]) throw new NotFoundError(u.label, id);
  if (rows[0].status !== 'OPERATIONAL') {
    throw new BusinessRuleError('EQUIPMENT_NOT_OPERATIONAL', `${u.label} ${rows[0].code} is ${rows[0].status}`, { status: rows[0].status });
  }
  return rows[0] as { id: string; equipment_id: string; code: string; name: string; status: string; capacity_kg?: string };
}

/**
 * Registers hoppers, pulping machines and fermentation tanks: each is an
 * equipment row (maintenance, status, schedules) plus its process detail row.
 */
export class ProcessingEquipmentService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditLogService,
    private readonly equipment: EquipmentService,
  ) {}

  async list(unit: ProcessingUnit) {
    const u = UNITS[unit];
    const extra = unit === 'tank'
      ? `, (SELECT row_to_json(b) FROM (SELECT fb.id, fb.batch_number, fb.start_at, l.lot_number FROM fermentation_batches fb
             JOIN lots l ON l.id = fb.lot_id WHERE fb.tank_id = x.id AND fb.status = 'IN_PROGRESS') b) AS active_batch`
      : unit === 'pulper'
        ? `, (SELECT row_to_json(i) FROM (SELECT pi.id, pi.inspection_date, pi.result, pi.inspected_at FROM pulping_machine_inspections pi
               WHERE pi.machine_id = x.id ORDER BY pi.inspection_date DESC LIMIT 1) i) AS last_inspection`
        : '';
    const { rows } = await this.pool.query(
      `SELECT x.id, x.equipment_id, ${u.capacity ? 'x.capacity_kg,' : ''} e.code, e.name, e.status, e.location ${extra}
         FROM ${u.table} x JOIN equipment e ON e.id = x.equipment_id
        WHERE e.status <> 'DECOMMISSIONED' ORDER BY e.code`,
    );
    return camelizeRows(rows);
  }

  async create(actor: AuthUser, unit: ProcessingUnit, input: { code: string; name: string; location?: string | null; capacityKg?: string }, meta: RequestMeta) {
    const u = UNITS[unit];
    if (u.capacity && !input.capacityKg) throw new BusinessRuleError('CAPACITY_REQUIRED', `${u.label} capacity (kg) is required`);
    return withTransaction(this.pool, async (tx) => {
      const equipmentId = await this.equipment.insert(tx, { code: input.code, name: input.name, location: input.location, type: u.type });
      const { rows } = u.capacity
        ? await tx.query(`INSERT INTO ${u.table} (equipment_id, capacity_kg) VALUES ($1, $2) RETURNING id`, [equipmentId, kg(input.capacityKg!)])
        : await tx.query(`INSERT INTO ${u.table} (equipment_id) VALUES ($1) RETURNING id`, [equipmentId]);
      await this.audit.record(tx, {
        userId: actor.id, action: 'CREATE', module: 'processing', entityType: u.label.replace(/ /g, ''), entityId: rows[0].id,
        newValue: { ...input, equipmentId }, meta,
      });
      const all = await tx.query(
        `SELECT x.id, x.equipment_id, ${u.capacity ? 'x.capacity_kg,' : ''} e.code, e.name, e.status, e.location
           FROM ${u.table} x JOIN equipment e ON e.id = x.equipment_id WHERE x.id = $1`,
        [rows[0].id],
      );
      return camelizeRows(all.rows)[0];
    });
  }
}
