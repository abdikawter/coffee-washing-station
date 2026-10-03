import type pg from 'pg';
import { Decimal, kg } from '../../common/decimal.js';
import { BusinessRuleError, NotFoundError } from '../../common/errors.js';
import { businessDate } from '../../common/util.js';
import type { AuditLogService } from '../../core/audit-log/audit-log.service.js';
import type { CorrectiveActionsService } from '../../core/corrective-actions/corrective-actions.service.js';
import type { LotService } from '../../core/lots/lot.service.js';
import type { OutboxService } from '../../core/outbox/outbox.service.js';
import type { SettingsService } from '../../core/settings/settings.service.js';
import { camelize, camelizeRows, withTransaction } from '../../db/pool.js';
import { Where } from '../../db/where.js';
import { pageClause, type PageQuery } from '../../http/schemas.js';
import type { AuthUser, RequestMeta } from '../../http/types.js';
import { machineInspectionResult, type MachineCheck } from './domain/wet-rules.js';
import { lockOperationalUnit } from './processing-equipment.service.js';

const RECORD_SELECT = `
  SELECT pr.*, l.lot_number, e.code AS machine_code, u.full_name AS operator_name
    FROM pulping_records pr
    JOIN lots l ON l.id = pr.lot_id
    JOIN pulping_machines m ON m.id = pr.machine_id JOIN equipment e ON e.id = m.equipment_id
    JOIN users u ON u.id = pr.operator_id`;

/**
 * Pulping (ARCHITECTURE.md §9.1 "Pulping"): machine OPERATIONAL and today's
 * machine inspection PASS per pulping.dailyInspectionPolicy — BLOCK refuses,
 * WARN allows and raises / recommends a PROCESS_VIOLATION corrective action.
 */
export class PulpingService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsService,
    private readonly lots: LotService,
    private readonly correctiveActions: CorrectiveActionsService,
    private readonly outbox: OutboxService,
  ) {}

  // ------------------------------------------------------------------ daily machine inspection

  async listInspections(machineId: string) {
    const { rows } = await this.pool.query(
      `SELECT pi.*, u.full_name AS inspector_name FROM pulping_machine_inspections pi JOIN users u ON u.id = pi.inspector_id
        WHERE pi.machine_id = $1 ORDER BY pi.inspection_date DESC LIMIT 100`,
      [machineId],
    );
    return camelizeRows(rows);
  }

  /** One inspection per machine per business day: disc teeth, disc spacing, cleaning. */
  async inspect(actor: AuthUser, machineId: string, input: MachineCheck & { discSpacingMm?: string | null; notes?: string | null }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const { rows: m } = await tx.query(
        `SELECT m.id, e.code, e.status FROM pulping_machines m JOIN equipment e ON e.id = m.equipment_id WHERE m.id = $1`,
        [machineId],
      );
      if (!m[0]) throw new NotFoundError('Pulping machine', machineId);
      if (m[0].status === 'DECOMMISSIONED') throw new BusinessRuleError('EQUIPMENT_DECOMMISSIONED', 'The machine is decommissioned');
      const day = businessDate(new Date(), await this.settings.getIn<string>(tx, 'station.timezone'));
      const dup = await tx.query('SELECT id FROM pulping_machine_inspections WHERE machine_id = $1 AND inspection_date = $2', [machineId, day]);
      if (dup.rows[0]) throw new BusinessRuleError('INSPECTION_ALREADY_RECORDED', `Machine ${m[0].code} was already inspected today`);
      const result = machineInspectionResult(input);
      const { rows } = await tx.query(
        `INSERT INTO pulping_machine_inspections (machine_id, inspection_date, inspected_at, disc_teeth_ok, disc_spacing_ok, disc_spacing_mm,
                                                  cleaning_done, result, inspector_id, notes)
         VALUES ($1,$2,now(),$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [machineId, day, input.discTeethOk, input.discSpacingOk, input.discSpacingMm ?? null, input.cleaningDone, result, actor.id, input.notes ?? null],
      );
      if (result === 'FAIL') {
        await this.outbox.emit(tx, { eventType: 'pulping.inspection-failed', aggregate: 'PulpingMachine', aggregateId: machineId, payload: { code: m[0].code, ...input } });
      }
      await this.audit.record(tx, {
        userId: actor.id, action: 'CREATE', module: 'processing', entityType: 'PulpingMachineInspection', entityId: rows[0].id,
        newValue: { machine: m[0].code, day, result, ...input }, meta,
      });
      return camelize(rows[0]);
    });
  }

  // ------------------------------------------------------------------ pulping records

  async listRecords(q: PageQuery & { lotId?: string; open?: boolean }) {
    const w = new Where().addIf(q.lotId, 'pr.lot_id = ?');
    if (q.open) w.add('pr.ended_at IS NULL');
    const { limit, offset } = pageClause(q);
    const [rows, count] = await Promise.all([
      this.pool.query(`${RECORD_SELECT} ${w.sql} ORDER BY pr.started_at DESC LIMIT ${limit} OFFSET ${offset}`, w.args),
      this.pool.query(`SELECT count(*)::int AS n FROM pulping_records pr ${w.sql}`, w.args),
    ]);
    return { data: camelizeRows(rows.rows), total: count.rows[0].n as number };
  }

  private async getRecord(db: pg.Pool | pg.PoolClient, id: string) {
    const { rows } = await db.query(`${RECORD_SELECT} WHERE pr.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundError('Pulping record', id);
    return camelize<Record<string, unknown>>(rows[0]);
  }

  /**
   * Lot FLOTATION → PULPING. Input defaults to the lot's current weight (sinkers).
   * Give outputKg to record a finished run in one step, or complete it later.
   */
  async record(actor: AuthUser, input: { lotId: string; machineId: string; inputKg?: string; outputKg?: string | null; notes?: string | null }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const lot = await this.lots.lockForStep(tx, input.lotId, 'FLOTATION');
      const machine = await lockOperationalUnit(tx, 'pulper', input.machineId);
      const inputKg = kg(input.inputKg ?? lot.currentWeightKg);
      if (input.outputKg && new Decimal(input.outputKg).gt(inputKg)) throw new BusinessRuleError('OUTPUT_EXCEEDS_INPUT', 'Pulping output cannot exceed the input');

      // Daily machine inspection gate.
      const tz = await this.settings.getIn<string>(tx, 'station.timezone');
      const day = businessDate(new Date(), tz);
      const { rows: insp } = await tx.query('SELECT result FROM pulping_machine_inspections WHERE machine_id = $1 AND inspection_date = $2', [machine.id, day]);
      const problem = !insp[0] ? 'MISSING' : insp[0].result !== 'PASS' ? 'FAILED' : null;
      let ca: Awaited<ReturnType<CorrectiveActionsService['raiseOrRecommend']>> | null = null;
      if (problem) {
        const policy = await this.settings.getIn<'BLOCK' | 'WARN'>(tx, 'pulping.dailyInspectionPolicy');
        if (policy === 'BLOCK') {
          throw new BusinessRuleError('PULPING_INSPECTION_REQUIRED', `Machine ${machine.code} has no passing inspection today (${problem})`, { machine: machine.code, problem, policy });
        }
        ca = await this.correctiveActions.raiseOrRecommend(tx, {
          source: 'PROCESS_VIOLATION', department: 'PRODUCTION', lotId: lot.id, raisedById: actor.id, responsibleId: actor.id,
          issue: `Lot ${lot.lotNumber} pulped on machine ${machine.code} without a passing daily inspection (${problem})`,
          correctiveAction: 'Inspect the pulping machine (disc teeth, spacing, cleaning) before further use; check the pulped coffee.',
          sourceRef: { machineId: machine.id, day, problem },
        });
      }

      const { rows } = await tx.query(
        `INSERT INTO pulping_records (lot_id, machine_id, started_at, ended_at, input_kg, output_kg, operator_id, notes)
         VALUES ($1, $2, now(), CASE WHEN $4::numeric IS NULL THEN NULL ELSE now() END, $3, $4, $5, $6) RETURNING id`,
        [lot.id, machine.id, inputKg, input.outputKg ? kg(input.outputKg) : null, actor.id, input.notes ?? null],
      );
      const id = rows[0].id as string;
      await this.lots.advance(tx, lot, 'PULPING', {
        eventType: 'PULPED', userId: actor.id, refType: 'PulpingRecord', refId: id, quantityKg: inputKg,
        newWeightKg: input.outputKg ? kg(input.outputKg) : null, location: machine.code,
        payload: { inputKg, outputKg: input.outputKg ? kg(input.outputKg) : null, inspection: problem ?? 'PASS' },
      });
      await this.audit.record(tx, {
        userId: actor.id, action: 'CREATE', module: 'processing', entityType: 'PulpingRecord', entityId: id,
        newValue: { lotNumber: lot.lotNumber, machine: machine.code, inputKg, outputKg: input.outputKg ?? null, inspection: problem ?? 'PASS', correctiveAction: ca }, meta,
      });
      return { ...(await this.getRecord(tx, id)), inspectionProblem: problem, correctiveAction: ca };
    });
  }

  /** Records the output of an open pulping run; the lot's current weight becomes the output. */
  async complete(actor: AuthUser, recordId: string, input: { outputKg: string; notes?: string | null }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query('SELECT * FROM pulping_records WHERE id = $1 FOR UPDATE', [recordId]);
      const rec = rows[0];
      if (!rec) throw new NotFoundError('Pulping record', recordId);
      if (rec.ended_at) throw new BusinessRuleError('PULPING_ALREADY_COMPLETED', 'This pulping run is already completed');
      if (new Decimal(input.outputKg).gt(rec.input_kg)) throw new BusinessRuleError('OUTPUT_EXCEEDS_INPUT', 'Pulping output cannot exceed the input');
      const lot = await this.lots.lockForStep(tx, rec.lot_id, 'PULPING');
      await tx.query(
        `UPDATE pulping_records SET ended_at = now(), output_kg = $2,
                notes = CASE WHEN $3::text IS NULL THEN notes ELSE concat_ws(E'\\n', notes, $3::text) END WHERE id = $1`,
        [recordId, kg(input.outputKg), input.notes ?? null],
      );
      await tx.query('UPDATE lots SET current_weight_kg = $2, version = version + 1 WHERE id = $1', [lot.id, kg(input.outputKg)]);
      await this.audit.record(tx, {
        userId: actor.id, action: 'UPDATE', module: 'processing', entityType: 'PulpingRecord', entityId: recordId,
        newValue: { lotNumber: lot.lotNumber, outputKg: kg(input.outputKg), step: 'complete' }, meta,
      });
      return this.getRecord(tx, recordId);
    });
  }
}
