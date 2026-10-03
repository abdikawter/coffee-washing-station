import type pg from 'pg';
import { Decimal, kg } from '../../common/decimal.js';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../common/errors.js';
import type { AuditLogService } from '../../core/audit-log/audit-log.service.js';
import type { CorrectiveActionsService } from '../../core/corrective-actions/corrective-actions.service.js';
import type { LotService } from '../../core/lots/lot.service.js';
import type { OutboxService } from '../../core/outbox/outbox.service.js';
import type { SequenceService } from '../../core/sequences/sequence.service.js';
import type { SettingsService } from '../../core/settings/settings.service.js';
import { camelize, camelizeRows, withTransaction } from '../../db/pool.js';
import { Where } from '../../db/where.js';
import { pageClause, type PageQuery } from '../../http/schemas.js';
import type { AuthUser, RequestMeta } from '../../http/types.js';
import { fermentationTiming } from './domain/wet-rules.js';
import { lockOperationalUnit } from './processing-equipment.service.js';

export const MUCILAGE = ['NOT_ASSESSED', 'INCOMPLETE', 'COMPLETE'] as const;
export type Mucilage = (typeof MUCILAGE)[number];

const BATCH_SELECT = `
  SELECT fb.*, l.lot_number, e.code AS tank_code, u.full_name AS operator_name
    FROM fermentation_batches fb
    JOIN lots l ON l.id = fb.lot_id
    JOIN fermentation_tanks t ON t.id = fb.tank_id JOIN equipment e ON e.id = t.equipment_id
    JOIN users u ON u.id = fb.operator_id`;

interface BatchRow {
  id: string;
  batchNumber: string;
  lotId: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  startAt: Date;
  minDurationHours: string;
  maxDurationHours: string;
  mucilageAssessment: Mucilage;
  [k: string]: unknown;
}

/**
 * Fermentation (ARCHITECTURE.md §9.1): one active batch per tank (DB partial
 * unique), duration window snapshotted from settings [MANUAL typical 24–48 h],
 * early completion needs a reason, completion needs mucilage COMPLETE when
 * fermentation.requireMucilageCompleteToEnd is on.
 */
export class FermentationService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsService,
    private readonly sequences: SequenceService,
    private readonly lots: LotService,
    private readonly correctiveActions: CorrectiveActionsService,
    private readonly outbox: OutboxService,
  ) {}

  private async withTiming<T extends BatchRow>(b: T, db: pg.Pool | pg.PoolClient = this.pool) {
    const lead = await this.settings.getIn<number>(db, 'fermentation.approachingLeadHours');
    const end = b.status === 'IN_PROGRESS' ? new Date() : ((b.endAt as Date | null) ?? new Date());
    return { ...b, timing: fermentationTiming(new Date(b.startAt), Number(b.minDurationHours), Number(b.maxDurationHours), lead, end) };
  }

  async list(q: PageQuery & { status?: string; lotId?: string }) {
    const w = new Where().addIf(q.status, 'fb.status = ?').addIf(q.lotId, 'fb.lot_id = ?');
    const { limit, offset } = pageClause(q);
    const [rows, count] = await Promise.all([
      this.pool.query(`${BATCH_SELECT} ${w.sql} ORDER BY (fb.status = 'IN_PROGRESS') DESC, fb.start_at DESC LIMIT ${limit} OFFSET ${offset}`, w.args),
      this.pool.query(`SELECT count(*)::int AS n FROM fermentation_batches fb ${w.sql}`, w.args),
    ]);
    const data = [];
    for (const b of camelizeRows<BatchRow>(rows.rows)) data.push(await this.withTiming(b));
    return { data, total: count.rows[0].n as number };
  }

  async get(id: string, db: pg.Pool | pg.PoolClient = this.pool) {
    const { rows } = await db.query(`${BATCH_SELECT} WHERE fb.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundError('Fermentation batch', id);
    const m = await db.query(
      `SELECT fm.*, u.full_name AS measured_by_name FROM fermentation_measurements fm JOIN users u ON u.id = fm.measured_by_id
        WHERE fm.batch_id = $1 ORDER BY fm.measured_at`,
      [id],
    );
    return { ...(await this.withTiming(camelize<BatchRow>(rows[0]), db)), measurements: camelizeRows(m.rows) };
  }

  /** Lot PULPING (run completed) → FERMENTATION in a free tank. */
  async start(actor: AuthUser, input: { lotId: string; tankId: string; inputKg?: string; expectedDurationHours?: number; notes?: string | null }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const lot = await this.lots.lockForStep(tx, input.lotId, 'PULPING');
      const open = await tx.query('SELECT id FROM pulping_records WHERE lot_id = $1 AND ended_at IS NULL', [lot.id]);
      if (open.rows[0]) throw new BusinessRuleError('PULPING_NOT_COMPLETED', 'Complete the pulping run (output weight) before fermentation');
      const tank = await lockOperationalUnit(tx, 'tank', input.tankId);
      const busy = await tx.query(`SELECT batch_number FROM fermentation_batches WHERE tank_id = $1 AND status = 'IN_PROGRESS'`, [tank.id]);
      if (busy.rows[0]) throw new BusinessRuleError('TANK_OCCUPIED', `Tank ${tank.code} is in use by batch ${busy.rows[0].batch_number}`);
      const inputKg = kg(input.inputKg ?? lot.currentWeightKg);
      if (new Decimal(inputKg).gt(tank.capacity_kg!)) {
        throw new BusinessRuleError('TANK_CAPACITY_EXCEEDED', `Tank ${tank.code} holds ${tank.capacity_kg} kg`, { inputKg, capacityKg: tank.capacity_kg });
      }
      const minH = await this.settings.getIn<number>(tx, 'fermentation.minHours');
      const maxH = await this.settings.getIn<number>(tx, 'fermentation.maxHours');
      const expected = input.expectedDurationHours ?? minH;
      if (expected < minH || expected > maxH) {
        throw new ValidationError([{ location: 'body', path: 'expectedDurationHours', message: `must be within ${minH}–${maxH} h (fermentation.minHours/maxHours)` }]);
      }
      const batchNumber = await this.sequences.next(tx, 'FB');
      const { rows } = await tx.query(
        `INSERT INTO fermentation_batches (batch_number, lot_id, tank_id, input_kg, start_at, expected_duration_hours, min_duration_hours,
                                           max_duration_hours, operator_id, notes)
         VALUES ($1,$2,$3,$4,now(),$5,$6,$7,$8,$9) RETURNING id, start_at`,
        [batchNumber, lot.id, tank.id, inputKg, expected, minH, maxH, actor.id, input.notes ?? null],
      );
      const id = rows[0].id as string;
      await this.lots.advance(tx, lot, 'FERMENTATION', {
        eventType: 'FERMENTATION_STARTED', userId: actor.id, refType: 'FermentationBatch', refId: id, quantityKg: inputKg,
        newWeightKg: inputKg, location: tank.code, payload: { batchNumber, minHours: minH, maxHours: maxH, expectedHours: expected },
      });
      await this.outbox.emit(tx, {
        eventType: 'fermentation.started', aggregate: 'FermentationBatch', aggregateId: id,
        payload: { batchNumber, lotNumber: lot.lotNumber, tank: tank.code, maxEndAt: new Date(new Date(rows[0].start_at).getTime() + maxH * 3_600_000) },
      });
      await this.audit.record(tx, {
        userId: actor.id, action: 'CREATE', module: 'processing', entityType: 'FermentationBatch', entityId: id,
        newValue: { batchNumber, lotNumber: lot.lotNumber, tank: tank.code, inputKg, minHours: minH, maxHours: maxH }, meta,
      });
      return this.get(id, tx);
    });
  }

  /** Temperature, pH, sweetness, acidity, mucilage. The latest mucilage assessment is kept on the batch. */
  async measure(
    actor: AuthUser, batchId: string,
    input: { temperatureC?: string | null; ph?: string | null; sweetness?: string | null; acidity?: string | null; mucilageAssessment: Mucilage; notes?: string | null },
    meta: RequestMeta,
  ) {
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query('SELECT id, status, batch_number FROM fermentation_batches WHERE id = $1 FOR UPDATE', [batchId]);
      if (!rows[0]) throw new NotFoundError('Fermentation batch', batchId);
      if (rows[0].status !== 'IN_PROGRESS') throw new BusinessRuleError('BATCH_NOT_IN_PROGRESS', `Batch ${rows[0].batch_number} is ${rows[0].status}`);
      const { rows: m } = await tx.query(
        `INSERT INTO fermentation_measurements (batch_id, measured_at, temperature_c, ph, sweetness, acidity, mucilage_assessment, measured_by_id, notes)
         VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [batchId, input.temperatureC ?? null, input.ph ?? null, input.sweetness ?? null, input.acidity ?? null, input.mucilageAssessment, actor.id, input.notes ?? null],
      );
      if (input.mucilageAssessment !== 'NOT_ASSESSED') {
        await tx.query('UPDATE fermentation_batches SET mucilage_assessment = $2 WHERE id = $1', [batchId, input.mucilageAssessment]);
      }
      await this.audit.record(tx, {
        userId: actor.id, action: 'CREATE', module: 'processing', entityType: 'FermentationMeasurement', entityId: m[0].id,
        newValue: { batchNumber: rows[0].batch_number, ...input }, meta,
      });
      return this.get(batchId, tx);
    });
  }

  /** IN_PROGRESS → COMPLETED. Event FERMENTATION_COMPLETED (stage stays FERMENTATION until washing). */
  async complete(actor: AuthUser, batchId: string, input: { reason?: string; outputKg?: string }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query('SELECT * FROM fermentation_batches WHERE id = $1 FOR UPDATE', [batchId]);
      const b = rows[0];
      if (!b) throw new NotFoundError('Fermentation batch', batchId);
      if (b.status !== 'IN_PROGRESS') throw new BusinessRuleError('BATCH_NOT_IN_PROGRESS', `Batch ${b.batch_number} is ${b.status}`);
      const lot = await this.lots.lockForStep(tx, b.lot_id, 'FERMENTATION');
      const lead = await this.settings.getIn<number>(tx, 'fermentation.approachingLeadHours');
      const timing = fermentationTiming(new Date(b.start_at), Number(b.min_duration_hours), Number(b.max_duration_hours), lead);
      if (timing.state === 'BEFORE_MIN' && !input.reason) {
        throw new BusinessRuleError('EARLY_COMPLETION_REASON_REQUIRED', `Only ${timing.elapsedHours} h of the minimum ${b.min_duration_hours} h: give a reason to complete early`, {
          elapsedHours: timing.elapsedHours, minHours: b.min_duration_hours,
        });
      }
      if ((await this.settings.getIn<boolean>(tx, 'fermentation.requireMucilageCompleteToEnd')) && b.mucilage_assessment !== 'COMPLETE') {
        throw new BusinessRuleError('MUCILAGE_NOT_COMPLETE', 'Record a mucilage assessment of COMPLETE before ending fermentation', { mucilageAssessment: b.mucilage_assessment });
      }
      if (input.outputKg && new Decimal(input.outputKg).gt(b.input_kg)) throw new BusinessRuleError('OUTPUT_EXCEEDS_INPUT', 'Output cannot exceed the fermentation input');
      await tx.query(
        `UPDATE fermentation_batches SET status = 'COMPLETED', end_at = now(),
                notes = CASE WHEN $2::text IS NULL THEN notes ELSE concat_ws(E'\\n', notes, $2::text) END WHERE id = $1`,
        [batchId, input.reason ? `Completed early: ${input.reason}` : null],
      );
      if (input.outputKg) await tx.query('UPDATE lots SET current_weight_kg = $2 WHERE id = $1', [lot.id, kg(input.outputKg)]);
      await this.lots.appendEvent(tx, {
        lotId: lot.id, eventType: 'FERMENTATION_COMPLETED', stage: 'FERMENTATION', userId: actor.id, refType: 'FermentationBatch', refId: batchId,
        quantityKg: input.outputKg ? kg(input.outputKg) : lot.currentWeightKg,
        payload: { batchNumber: b.batch_number, elapsedHours: timing.elapsedHours, state: timing.state, reason: input.reason ?? null },
      });
      const ca = timing.state === 'OVERDUE' ? await this.correctiveActions.raiseOrRecommend(tx, {
        source: 'PROCESS_VIOLATION', department: 'PRODUCTION', lotId: lot.id, raisedById: actor.id, responsibleId: actor.id,
        issue: `Fermentation ${b.batch_number} (lot ${lot.lotNumber}) ran ${timing.elapsedHours} h, beyond the ${b.max_duration_hours} h maximum`,
        correctiveAction: 'Check the coffee for over-fermentation defects; review tank scheduling and monitoring.',
        sourceRef: { batchId, elapsedHours: timing.elapsedHours },
      }) : null;
      await this.audit.record(tx, {
        userId: actor.id, action: 'UPDATE', module: 'processing', entityType: 'FermentationBatch', entityId: batchId,
        previousValue: { status: 'IN_PROGRESS' }, newValue: { status: 'COMPLETED', ...timing, reason: input.reason ?? null, correctiveAction: ca }, meta,
      });
      return { ...(await this.get(batchId, tx)), correctiveAction: ca };
    });
  }

  /** In-progress batches approaching or past their maximum (fermentation-monitor job). */
  async monitor(): Promise<{ batchNumber: string; lotNumber: string; tankCode: string; state: string; elapsedHours: string }[]> {
    const { data } = await this.list({ page: 1, pageSize: 100, sort: 'startAt', status: 'IN_PROGRESS' });
    return data
      .filter((b) => b.timing.state === 'APPROACHING_MAX' || b.timing.state === 'OVERDUE')
      .map((b) => ({ batchNumber: b.batchNumber, lotNumber: b.lotNumber as string, tankCode: b.tankCode as string, state: b.timing.state, elapsedHours: b.timing.elapsedHours }));
  }
}
