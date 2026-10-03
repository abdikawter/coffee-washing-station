import type pg from 'pg';
import { Decimal, kg } from '../../common/decimal.js';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../common/errors.js';
import { businessDate, randomToken } from '../../common/util.js';
import type { AuditLogService } from '../../core/audit-log/audit-log.service.js';
import type { LotService } from '../../core/lots/lot.service.js';
import type { OutboxService } from '../../core/outbox/outbox.service.js';
import type { SettingsService } from '../../core/settings/settings.service.js';
import { camelize, camelizeRows, withTransaction } from '../../db/pool.js';
import { Where } from '../../db/where.js';
import { pageClause, type PageQuery } from '../../http/schemas.js';
import type { AuthUser, RequestMeta } from '../../http/types.js';
import { gradingCheck } from './domain/wet-rules.js';

/** Child lot number from numbering.formats LOT_CHILD, e.g. "{PARENT}-{GRADE}" → LOT-261003-0001-G1. */
export function childLotNumber(format: string, parent: string, gradeCode: string): string {
  return format.replaceAll('{PARENT}', parent).replaceAll('{GRADE}', gradeCode);
}

/**
 * Washing and grading (ARCHITECTURE.md §9.1): washing after a completed
 * fermentation; grading splits the washed lot into one child lot per parchment
 * grade (Σ outputs ≤ washed output + grading.outputTolerancePct) and marks the
 * parent SPLIT. Child lots keep the root's original cherry weight for outturn.
 */
export class WashingGradingService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsService,
    private readonly lots: LotService,
    private readonly outbox: OutboxService,
  ) {}

  async listWashing(q: PageQuery & { lotId?: string }) {
    const w = new Where().addIf(q.lotId, 'wr.lot_id = ?');
    const { limit, offset } = pageClause(q);
    const [rows, count] = await Promise.all([
      this.pool.query(
        `SELECT wr.*, l.lot_number, u.full_name AS operator_name FROM washing_records wr JOIN lots l ON l.id = wr.lot_id
           JOIN users u ON u.id = wr.operator_id ${w.sql} ORDER BY wr.washed_at DESC LIMIT ${limit} OFFSET ${offset}`,
        w.args,
      ),
      this.pool.query(`SELECT count(*)::int AS n FROM washing_records wr ${w.sql}`, w.args),
    ]);
    return { data: camelizeRows(rows.rows), total: count.rows[0].n as number };
  }

  /** Lot FERMENTATION (batch completed) → WASHING. Output ≤ input. */
  async wash(actor: AuthUser, input: { lotId: string; inputKg?: string; outputKg: string; densitySeparation?: string | null; notes?: string | null }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const lot = await this.lots.lockForStep(tx, input.lotId, 'FERMENTATION');
      const { rows: fb } = await tx.query(
        `SELECT status, batch_number FROM fermentation_batches WHERE lot_id = $1 AND status <> 'CANCELLED' ORDER BY start_at DESC LIMIT 1`,
        [lot.id],
      );
      if (fb[0]?.status !== 'COMPLETED') {
        throw new BusinessRuleError('FERMENTATION_NOT_COMPLETED', 'Complete the fermentation batch before washing', { batch: fb[0]?.batch_number ?? null });
      }
      const inputKg = kg(input.inputKg ?? lot.currentWeightKg);
      if (new Decimal(input.outputKg).gt(inputKg)) throw new BusinessRuleError('OUTPUT_EXCEEDS_INPUT', 'Washing output cannot exceed the input', { inputKg });
      const { rows } = await tx.query(
        `INSERT INTO washing_records (lot_id, washed_at, input_kg, output_kg, density_separation, operator_id, notes)
         VALUES ($1, now(), $2, $3, $4, $5, $6) RETURNING *`,
        [lot.id, inputKg, kg(input.outputKg), input.densitySeparation ?? null, actor.id, input.notes ?? null],
      );
      await this.lots.advance(tx, lot, 'WASHING', {
        eventType: 'WASHED', userId: actor.id, refType: 'WashingRecord', refId: rows[0].id, quantityKg: kg(input.outputKg),
        newWeightKg: kg(input.outputKg), payload: { inputKg, outputKg: kg(input.outputKg) },
      });
      await this.audit.record(tx, {
        userId: actor.id, action: 'CREATE', module: 'processing', entityType: 'WashingRecord', entityId: rows[0].id,
        newValue: { lotNumber: lot.lotNumber, inputKg, outputKg: kg(input.outputKg) }, meta,
      });
      return { ...camelize<Record<string, unknown>>(rows[0]), lotNumber: lot.lotNumber };
    });
  }

  async listGrading(q: PageQuery & { lotId?: string }) {
    const w = new Where().addIf(q.lotId, 'gr.lot_id = ?');
    const { limit, offset } = pageClause(q);
    const [rows, count] = await Promise.all([
      this.pool.query(
        `SELECT gr.*, l.lot_number, u.full_name AS graded_by_name,
                (SELECT json_agg(json_build_object('gradeId', go.grade_id, 'gradeCode', g.code, 'weightKg', go.weight_kg,
                                                   'childLotId', go.child_lot_id, 'childLotNumber', cl.lot_number) ORDER BY g.sort_order)
                   FROM grade_outputs go JOIN coffee_grades g ON g.id = go.grade_id JOIN lots cl ON cl.id = go.child_lot_id
                  WHERE go.grading_record_id = gr.id) AS outputs
           FROM grading_records gr JOIN lots l ON l.id = gr.lot_id JOIN users u ON u.id = gr.graded_by_id
          ${w.sql} ORDER BY gr.graded_at DESC LIMIT ${limit} OFFSET ${offset}`,
        w.args,
      ),
      this.pool.query(`SELECT count(*)::int AS n FROM grading_records gr ${w.sql}`, w.args),
    ]);
    return { data: camelizeRows(rows.rows), total: count.rows[0].n as number };
  }

  /** Lot WASHING → GRADING + SPLIT, with one child lot (GRADE_SPLIT, stage GRADING) per grade. */
  async grade(actor: AuthUser, input: { lotId: string; outputs: { gradeId: string; weightKg: string }[]; notes?: string | null }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const lot = await this.lots.lockForStep(tx, input.lotId, 'WASHING');
      const gradeIds = input.outputs.map((o) => o.gradeId);
      if (new Set(gradeIds).size !== gradeIds.length) throw new ValidationError([{ location: 'body', path: 'outputs', message: 'each grade may appear once' }]);
      const { rows: grades } = await tx.query(`SELECT id, code FROM coffee_grades WHERE id = ANY($1) AND stage = 'PARCHMENT' AND is_active`, [gradeIds]);
      if (grades.length !== gradeIds.length) throw new BusinessRuleError('GRADE_INVALID', 'Grading outputs must use active parchment grades');
      const codeOf = new Map(grades.map((g) => [g.id as string, g.code as string]));

      const { rows: wr } = await tx.query('SELECT id, output_kg FROM washing_records WHERE lot_id = $1 ORDER BY washed_at DESC LIMIT 1', [lot.id]);
      if (!wr[0]) throw new NotFoundError('Washing record for lot', lot.lotNumber);
      const tolerance = await this.settings.getIn<number>(tx, 'grading.outputTolerancePct');
      const check = gradingCheck(input.outputs.map((o) => o.weightKg), wr[0].output_kg, tolerance);
      if (!check.withinLimit) {
        throw new BusinessRuleError('GRADING_EXCEEDS_WASHED', `Grade outputs ${check.totalKg} kg exceed the washed ${kg(wr[0].output_kg)} kg (+ ${tolerance} %)`, check);
      }

      const { rows: gr } = await tx.query(
        `INSERT INTO grading_records (washing_record_id, lot_id, graded_at, graded_by_id, total_output_kg, notes)
         VALUES ($1, $2, now(), $3, $4, $5) RETURNING id`,
        [wr[0].id, lot.id, actor.id, check.totalKg, input.notes ?? null],
      );
      const gradingId = gr[0].id as string;
      await this.lots.advance(tx, lot, 'GRADING', {
        eventType: 'GRADED', userId: actor.id, refType: 'GradingRecord', refId: gradingId, quantityKg: check.totalKg,
        newWeightKg: check.totalKg, payload: { outputs: input.outputs.map((o) => ({ grade: codeOf.get(o.gradeId), weightKg: kg(o.weightKg) })) },
      });

      const formats = await this.settings.getIn<Record<string, string>>(tx, 'numbering.formats');
      const tz = await this.settings.getIn<string>(tx, 'station.timezone');
      const planned = input.outputs.map((o) => ({
        ...o, grade: codeOf.get(o.gradeId)!, lotNumber: childLotNumber(formats.LOT_CHILD ?? '{PARENT}-{GRADE}', lot.lotNumber, codeOf.get(o.gradeId)!),
      }));
      // The parent's split event comes first, so a grade lot's timeline reads parent history → its own split.
      await tx.query(`UPDATE lots SET status = 'SPLIT' WHERE id = $1`, [lot.id]);
      await this.lots.appendEvent(tx, {
        lotId: lot.id, eventType: 'LOT_SPLIT', stage: 'GRADING', userId: actor.id, refType: 'GradingRecord', refId: gradingId,
        quantityKg: check.totalKg, payload: { children: planned.map((c) => ({ lotNumber: c.lotNumber, grade: c.grade, weightKg: kg(c.weightKg) })) },
      });
      const children: { id: string; lotNumber: string; grade: string; weightKg: string }[] = [];
      for (const o of planned) {
        const { grade, lotNumber } = o;
        const { rows: c } = await tx.query(
          `INSERT INTO lots (lot_number, type, supplier_id, parent_lot_id, original_cherry_weight_kg, current_weight_kg, processing_date,
                             current_stage, grade_id, status, qr_token)
           VALUES ($1, 'GRADE_SPLIT', $2, $3, $4, $5, $6, 'GRADING', $7, 'ACTIVE', $8) RETURNING id`,
          [lotNumber, lot.supplierId, lot.id, lot.originalCherryWeightKg, kg(o.weightKg), businessDate(new Date(), tz), o.gradeId, randomToken(24)],
        );
        await tx.query('INSERT INTO grade_outputs (grading_record_id, grade_id, weight_kg, child_lot_id) VALUES ($1, $2, $3, $4)', [gradingId, o.gradeId, kg(o.weightKg), c[0].id]);
        await this.lots.appendEvent(tx, {
          lotId: c[0].id, eventType: 'LOT_SPLIT', stage: 'GRADING', userId: actor.id, refType: 'GradingRecord', refId: gradingId,
          quantityKg: kg(o.weightKg), payload: { parentLotNumber: lot.lotNumber, grade },
        });
        children.push({ id: c[0].id, lotNumber, grade, weightKg: kg(o.weightKg) });
      }
      await this.outbox.emit(tx, { eventType: 'lot.graded', aggregate: 'Lot', aggregateId: lot.id, payload: { lotNumber: lot.lotNumber, children } });
      await this.audit.record(tx, {
        userId: actor.id, action: 'CREATE', module: 'processing', entityType: 'GradingRecord', entityId: gradingId,
        newValue: { lotNumber: lot.lotNumber, totalKg: check.totalKg, children }, meta,
      });
      return { id: gradingId, lotId: lot.id, lotNumber: lot.lotNumber, totalOutputKg: check.totalKg, children };
    });
  }
}
