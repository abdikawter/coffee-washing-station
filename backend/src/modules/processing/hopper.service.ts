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
import { flotationBalance, reconcile } from './domain/wet-rules.js';
import { lockOperationalUnit } from './processing-equipment.service.js';

const INTAKE_SELECT = `
  SELECT hr.*, l.lot_number, l.current_stage, l.status AS lot_status, e.code AS hopper_code, u.full_name AS operator_name
    FROM hopper_records hr
    JOIN lots l ON l.id = hr.lot_id
    JOIN hoppers h ON h.id = hr.hopper_id JOIN equipment e ON e.id = h.equipment_id
    JOIN users u ON u.id = hr.operator_id`;

/**
 * Hopper intake, flotation and the daily purchased-vs-intake reconciliation
 * (ARCHITECTURE.md §9.1 "Hopper", "Flotation"; §11.2 "Hopper reconciliation").
 */
export class HopperService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsService,
    private readonly lots: LotService,
    private readonly correctiveActions: CorrectiveActionsService,
    private readonly outbox: OutboxService,
  ) {}

  async listIntakes(q: PageQuery & { lotId?: string; pendingFlotation?: boolean }) {
    const w = new Where().addIf(q.lotId, 'hr.lot_id = ?');
    if (q.pendingFlotation) w.add('hr.flotation_at IS NULL');
    const { limit, offset } = pageClause(q);
    const [rows, count] = await Promise.all([
      this.pool.query(`${INTAKE_SELECT} ${w.sql} ORDER BY hr.intake_at DESC LIMIT ${limit} OFFSET ${offset}`, w.args),
      this.pool.query(`SELECT count(*)::int AS n FROM hopper_records hr ${w.sql}`, w.args),
    ]);
    return { data: camelizeRows(rows.rows), total: count.rows[0].n as number };
  }

  private async getIntake(db: pg.Pool | pg.PoolClient, id: string) {
    const { rows } = await db.query(`${INTAKE_SELECT} WHERE hr.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundError('Hopper intake', id);
    return camelize<Record<string, unknown>>(rows[0]);
  }

  /** Lot PURCHASED, not on hold → HOPPER. Intake above the hopper capacity is allowed with a warning. */
  async intake(actor: AuthUser, input: { lotId: string; hopperId: string; intakeKg: string; notes?: string | null }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const lot = await this.lots.lockForStep(tx, input.lotId, 'PURCHASED');
      const hopper = await lockOperationalUnit(tx, 'hopper', input.hopperId);
      const warnings: string[] = [];
      if (new Decimal(input.intakeKg).gt(hopper.capacity_kg!)) warnings.push(`Intake exceeds hopper ${hopper.code} capacity (${hopper.capacity_kg} kg)`);
      const { rows } = await tx.query(
        `INSERT INTO hopper_records (hopper_id, lot_id, intake_at, purchased_cherry_kg, intake_kg, operator_id, notes)
         VALUES ($1, $2, now(), $3, $4, $5, $6) RETURNING id`,
        [hopper.id, lot.id, lot.originalCherryWeightKg, kg(input.intakeKg), actor.id, input.notes ?? null],
      );
      const id = rows[0].id as string;
      await this.lots.advance(tx, lot, 'HOPPER', {
        eventType: 'HOPPER_RECEIVED', userId: actor.id, refType: 'HopperRecord', refId: id, quantityKg: kg(input.intakeKg),
        newWeightKg: kg(input.intakeKg), location: hopper.code, payload: { purchasedKg: lot.originalCherryWeightKg, warnings },
      });
      await this.audit.record(tx, {
        userId: actor.id, action: 'CREATE', module: 'processing', entityType: 'HopperRecord', entityId: id,
        newValue: { lotNumber: lot.lotNumber, hopper: hopper.code, intakeKg: kg(input.intakeKg), warnings }, meta,
      });
      return { ...(await this.getIntake(tx, id)), warnings };
    });
  }

  /**
   * Flotation: floaters are separated (recorded as a quantity only — open question 7),
   * sinkers continue. Floaters + sinkers vs intake within
   * hopper.flotationBalanceTolerancePct; an imbalance raises / recommends a CA.
   */
  async flotation(actor: AuthUser, intakeId: string, input: { floatersKg: string; sinkersKg: string; notes?: string | null }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query('SELECT * FROM hopper_records WHERE id = $1 FOR UPDATE', [intakeId]);
      const rec = rows[0];
      if (!rec) throw new NotFoundError('Hopper intake', intakeId);
      if (rec.flotation_at) throw new BusinessRuleError('FLOTATION_ALREADY_RECORDED', 'Flotation was already recorded for this intake');
      if (new Decimal(input.sinkersKg).lte(0)) throw new BusinessRuleError('INVALID_WEIGHT', 'Sinkers must be greater than zero');
      const lot = await this.lots.lockForStep(tx, rec.lot_id, 'HOPPER');
      const tolerance = await this.settings.getIn<number>(tx, 'hopper.flotationBalanceTolerancePct');
      const balance = flotationBalance(rec.intake_kg, input.floatersKg, input.sinkersKg, tolerance);
      await tx.query(
        `UPDATE hopper_records SET floaters_kg = $2, sinkers_kg = $3, flotation_at = now(),
                notes = CASE WHEN $4::text IS NULL THEN notes ELSE concat_ws(E'\\n', notes, $4::text) END WHERE id = $1`,
        [intakeId, kg(input.floatersKg), kg(input.sinkersKg), input.notes ?? null],
      );
      await this.lots.advance(tx, lot, 'FLOTATION', {
        eventType: 'FLOTATION_COMPLETED', userId: actor.id, refType: 'HopperRecord', refId: intakeId, quantityKg: kg(input.sinkersKg),
        newWeightKg: kg(input.sinkersKg), payload: { floatersKg: kg(input.floatersKg), sinkersKg: kg(input.sinkersKg), balance },
      });
      const ca = balance.withinTolerance ? null : await this.correctiveActions.raiseOrRecommend(tx, {
        source: 'WEIGHT_DISCREPANCY', department: 'PRODUCTION', lotId: lot.id, raisedById: actor.id, responsibleId: actor.id,
        issue: `Flotation imbalance on lot ${lot.lotNumber}: floaters + sinkers ${balance.totalKg} kg vs intake ${kg(rec.intake_kg)} kg (${balance.differencePct} %, tolerance ${tolerance} %)`,
        correctiveAction: 'Re-weigh floaters and sinkers; check the hopper and flotation tank for losses or recording errors.',
        sourceRef: { hopperRecordId: intakeId, ...balance },
      });
      await this.audit.record(tx, {
        userId: actor.id, action: 'UPDATE', module: 'processing', entityType: 'HopperRecord', entityId: intakeId,
        newValue: { lotNumber: lot.lotNumber, step: 'flotation', ...balance, correctiveAction: ca }, meta,
      });
      return { ...(await this.getIntake(tx, intakeId)), balance, correctiveAction: ca };
    });
  }

  // ------------------------------------------------------------------ reconciliation

  async listReconciliations(q: PageQuery & { status?: string; from?: string; to?: string }) {
    const w = new Where().addIf(q.status, 'r.status = ?').addIf(q.from, 'r.recon_date >= ?').addIf(q.to, 'r.recon_date <= ?');
    const { limit, offset } = pageClause(q);
    const [rows, count] = await Promise.all([
      this.pool.query(
        `SELECT r.*, u.full_name AS reviewed_by_name FROM hopper_reconciliations r LEFT JOIN users u ON u.id = r.reviewed_by_id
          ${w.sql} ORDER BY r.recon_date DESC LIMIT ${limit} OFFSET ${offset}`,
        w.args,
      ),
      this.pool.query(`SELECT count(*)::int AS n FROM hopper_reconciliations r ${w.sql}`, w.args),
    ]);
    return { data: camelizeRows(rows.rows), total: count.rows[0].n as number };
  }

  private async getReconciliation(db: pg.Pool | pg.PoolClient, id: string) {
    const { rows } = await db.query(
      `SELECT r.*, u.full_name AS reviewed_by_name FROM hopper_reconciliations r LEFT JOIN users u ON u.id = r.reviewed_by_id WHERE r.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundError('Hopper reconciliation', id);
    return camelize<Record<string, unknown> & { reconDate: string; status: string }>(rows[0]);
  }

  /**
   * Compares purchased cherry with hopper intake for every lot taken into a hopper
   * on `date` (station timezone). Re-running replaces the figures until the day
   * has been REVIEWED. A new DISCREPANCY raises / recommends a CA.
   * `actor` is null when the daily job runs it (then a discrepancy is only signalled).
   */
  async run(actor: AuthUser | null, date: string | undefined, meta?: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const tz = await this.settings.getIn<string>(tx, 'station.timezone');
      const today = businessDate(new Date(), tz);
      const day = date ?? today;
      if (day > today) throw new BusinessRuleError('FUTURE_DATED', 'Cannot reconcile a future date');
      const tolerance = await this.settings.getIn<number>(tx, 'hopper.reconciliationTolerancePct');
      const { rows: lines } = await tx.query(
        `SELECT l.id AS lot_id, l.lot_number, hr.purchased_cherry_kg, hr.intake_kg FROM hopper_records hr JOIN lots l ON l.id = hr.lot_id
          WHERE (hr.intake_at AT TIME ZONE $2)::date = $1::date ORDER BY l.lot_number`,
        [day, tz],
      );
      const result = reconcile(lines.map((l) => ({ lotId: l.lot_id, lotNumber: l.lot_number, purchasedKg: l.purchased_cherry_kg, intakeKg: l.intake_kg })), tolerance);

      const { rows: existing } = await tx.query('SELECT id, status FROM hopper_reconciliations WHERE recon_date = $1 FOR UPDATE', [day]);
      const prev = existing[0];
      if (prev?.status === 'REVIEWED') throw new BusinessRuleError('RECONCILIATION_REVIEWED', `The reconciliation of ${day} was already reviewed`);
      const values = [result.purchasedKg, result.intakeKg, result.differenceKg, result.differencePct, tolerance, result.status, JSON.stringify(result.detail)];
      const { rows } = prev
        ? await tx.query(
          `UPDATE hopper_reconciliations SET purchased_cherry_kg = $2, hopper_intake_kg = $3, difference_kg = $4, difference_pct = $5,
                  tolerance_pct = $6, status = $7, detail = $8 WHERE id = $1 RETURNING id`,
          [prev.id, ...values],
        )
        : await tx.query(
          `INSERT INTO hopper_reconciliations (recon_date, purchased_cherry_kg, hopper_intake_kg, difference_kg, difference_pct, tolerance_pct, status, detail)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [day, ...values],
        );
      const id = rows[0].id as string;

      let ca: Awaited<ReturnType<CorrectiveActionsService['raiseOrRecommend']>> | null = null;
      if (result.status === 'DISCREPANCY' && prev?.status !== 'DISCREPANCY') {
        if (actor) {
          ca = await this.correctiveActions.raiseOrRecommend(tx, {
            source: 'WEIGHT_DISCREPANCY', department: 'PRODUCTION', reconciliationId: id, raisedById: actor.id, responsibleId: actor.id,
            issue: `Hopper reconciliation ${day}: intake ${result.intakeKg} kg vs purchased ${result.purchasedKg} kg (${result.differencePct} %, tolerance ${tolerance} %)`,
            correctiveAction: 'Check the weighings and hopper records of the flagged lots; explain or correct the difference.',
            sourceRef: { reconDate: day, flaggedLots: result.detail.filter((l) => l.flagged).map((l) => l.lotNumber) },
          });
        } else {
          await this.outbox.emit(tx, { eventType: 'hopper.reconciliation-discrepancy', aggregate: 'HopperReconciliation', aggregateId: id, payload: { reconDate: day, ...result } });
        }
      }
      await this.audit.record(tx, {
        userId: actor?.id ?? null, action: prev ? 'UPDATE' : 'CREATE', module: 'processing', entityType: 'HopperReconciliation', entityId: id,
        newValue: { reconDate: day, status: result.status, differencePct: result.differencePct, tolerance, lots: lines.length, correctiveAction: ca }, meta,
      });
      return { ...(await this.getReconciliation(tx, id)), correctiveAction: ca };
    });
  }

  /** Site Manager review of a discrepancy (reconciliation:review). */
  async review(actor: AuthUser, id: string, notes: string, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query('SELECT id, status, recon_date FROM hopper_reconciliations WHERE id = $1 FOR UPDATE', [id]);
      if (!rows[0]) throw new NotFoundError('Hopper reconciliation', id);
      if (rows[0].status !== 'DISCREPANCY') throw new BusinessRuleError('NOTHING_TO_REVIEW', `Only a DISCREPANCY can be reviewed (status ${rows[0].status})`);
      await tx.query(
        `UPDATE hopper_reconciliations SET status = 'REVIEWED', reviewed_by_id = $2, reviewed_at = now(), review_notes = $3 WHERE id = $1`,
        [id, actor.id, notes],
      );
      await this.audit.record(tx, {
        userId: actor.id, action: 'APPROVE', module: 'processing', entityType: 'HopperReconciliation', entityId: id,
        previousValue: { status: 'DISCREPANCY' }, newValue: { status: 'REVIEWED', reconDate: rows[0].recon_date, notes }, meta,
      });
      return this.getReconciliation(tx, id);
    });
  }
}
