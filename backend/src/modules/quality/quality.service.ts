import type pg from 'pg';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../common/errors.js';
import type { AuditLogService } from '../../core/audit-log/audit-log.service.js';
import type { SequenceService } from '../../core/sequences/sequence.service.js';
import type { SettingsService } from '../../core/settings/settings.service.js';
import { camelize, camelizeRows, withTransaction } from '../../db/pool.js';
import { Where } from '../../db/where.js';
import { orderBy, pageClause, type PageQuery } from '../../http/schemas.js';
import type { AuthUser, RequestMeta } from '../../http/types.js';
import {
  evaluateQualityRules, percentSum, percentSumWithinTolerance, type CherryPercentages, type ComparisonOperator, type QualityMetric,
  type QualityRule, type RuleAction,
} from './domain/quality-rules.js';

export interface InspectionInput extends CherryPercentages {
  supplierId: string;
  qualityGradeId?: string | null;
  decision: 'ACCEPTED' | 'REJECTED';
  rejectionReason?: string | null;
  notes?: string | null;
}

export interface RuleInput {
  name: string;
  metric: QualityMetric;
  operator: ComparisonOperator;
  threshold: string;
  action: RuleAction;
  description?: string | null;
  isActive?: boolean;
}

const INSPECTION_SELECT = `
  SELECT qi.*, s.supplier_code, s.full_name AS supplier_name, g.code AS grade_code, u.full_name AS inspector_name,
         pv.id AS voucher_id, pv.voucher_no
    FROM quality_inspections qi
    JOIN suppliers s ON s.id = qi.supplier_id
    JOIN users u ON u.id = qi.inspector_id
    LEFT JOIN coffee_grades g ON g.id = qi.quality_grade_id
    LEFT JOIN purchase_vouchers pv ON pv.quality_inspection_id = qi.id`;

/**
 * Quality inspections, quality rules and the reference data used when buying
 * (coffee types, grades). ARCHITECTURE.md §9.1 "Quality inspection".
 */
export class QualityService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsService,
    private readonly sequences: SequenceService,
  ) {}

  // ------------------------------------------------------------------ inspections

  async listInspections(q: PageQuery & { supplierId?: string; decision?: string; available?: boolean }) {
    const w = new Where().addIf(q.supplierId, 'qi.supplier_id = ?').addIf(q.decision, 'qi.decision = ?');
    if (q.available === true) w.add(`qi.decision = 'ACCEPTED' AND pv.id IS NULL`);
    if (q.available === false) w.add('pv.id IS NOT NULL');
    const { limit, offset } = pageClause(q);
    const [rows, count] = await Promise.all([
      this.pool.query(`${INSPECTION_SELECT} ${w.sql} ORDER BY ${orderBy(q.sort, { inspectedAt: 'qi.inspected_at' })}, qi.id LIMIT ${limit} OFFSET ${offset}`, w.args),
      this.pool.query(`SELECT count(*)::int AS n FROM quality_inspections qi LEFT JOIN purchase_vouchers pv ON pv.quality_inspection_id = qi.id ${w.sql}`, w.args),
    ]);
    return { data: camelizeRows(rows.rows), total: count.rows[0].n as number };
  }

  async getInspection(id: string, db: pg.Pool | pg.PoolClient = this.pool) {
    const { rows } = await db.query(`${INSPECTION_SELECT} WHERE qi.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundError('Quality inspection', id);
    return camelize(rows[0]);
  }

  /**
   * Records an inspection. The supplier must be ACTIVE; the three percentages
   * must add up to 100 within quality.percentSumTolerance; active REJECT rules
   * force the decision to REJECTED; WARN rules are recorded. The evaluation and
   * tolerance are snapshotted on the inspection.
   */
  async inspect(actor: AuthUser, input: InspectionInput, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const sup = await tx.query('SELECT id, status FROM suppliers WHERE id = $1 FOR SHARE', [input.supplierId]);
      if (!sup.rows[0]) throw new NotFoundError('Supplier', input.supplierId);
      if (sup.rows[0].status !== 'ACTIVE') {
        throw new BusinessRuleError('SUPPLIER_NOT_ACTIVE', 'Only ACTIVE suppliers can be inspected', { status: sup.rows[0].status });
      }
      const tolerance = await this.settings.getIn<number>(tx, 'quality.percentSumTolerance');
      if (!percentSumWithinTolerance(input, tolerance)) {
        throw new BusinessRuleError('PERCENT_SUM_OUT_OF_TOLERANCE', `Red + green + overripe must add up to 100 % (± ${tolerance})`, {
          sum: percentSum(input), tolerance,
        });
      }
      if (input.qualityGradeId) await this.assertGrade(tx, input.qualityGradeId, 'CHERRY');

      const rules = await tx.query(`SELECT id, name, metric, operator, threshold, action FROM quality_settings WHERE is_active ORDER BY name`);
      const evaluation = evaluateQualityRules(camelizeRows<QualityRule>(rules.rows), input);
      const forced = evaluation.outcome === 'REJECT' && input.decision === 'ACCEPTED';
      const decision = evaluation.outcome === 'REJECT' ? 'REJECTED' : input.decision;
      let rejectionReason = input.rejectionReason?.trim() || null;
      if (decision === 'REJECTED' && !rejectionReason) {
        if (evaluation.outcome !== 'REJECT') {
          throw new ValidationError([{ location: 'body', path: 'rejectionReason', message: 'a reason is required when rejecting' }]);
        }
        rejectionReason = `Rejected by rule: ${evaluation.results.filter((r) => r.triggered && r.action === 'REJECT').map((r) => r.name).join(', ')}`;
      }

      const inspectionNo = await this.sequences.next(tx, 'QI');
      const { rows } = await tx.query(
        `INSERT INTO quality_inspections (inspection_no, supplier_id, inspector_id, inspected_at, red_ripe_pct, green_unripe_pct,
                                          overripe_damaged_pct, quality_grade_id, decision, rejection_reason, rule_evaluation, notes)
         VALUES ($1,$2,$3,now(),$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [inspectionNo, input.supplierId, actor.id, input.redRipePct, input.greenUnripePct, input.overripeDamagedPct, input.qualityGradeId ?? null,
          decision, decision === 'REJECTED' ? rejectionReason : null,
          JSON.stringify({ ...evaluation, percentSumTolerance: tolerance, inspectorDecision: input.decision, forcedRejection: forced }), input.notes ?? null],
      );
      const created = await this.getInspection(rows[0].id, tx);
      await this.audit.record(tx, {
        userId: actor.id, action: 'CREATE', module: 'quality', entityType: 'QualityInspection', entityId: rows[0].id,
        newValue: { inspectionNo, supplierId: input.supplierId, decision, outcome: evaluation.outcome, forcedRejection: forced }, meta,
      });
      return created;
    });
  }

  // ------------------------------------------------------------------ rules

  async listRules() {
    const { rows } = await this.pool.query('SELECT * FROM quality_settings ORDER BY is_active DESC, name');
    return camelizeRows(rows);
  }

  async createRule(actor: AuthUser, input: RuleInput, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO quality_settings (name, metric, operator, threshold, action, description, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [input.name.trim(), input.metric, input.operator, input.threshold, input.action, input.description ?? null, input.isActive ?? true],
      );
      const created = camelize(rows[0]);
      await this.audit.record(tx, { userId: actor.id, action: 'CREATE', module: 'quality', entityType: 'QualityRule', entityId: rows[0].id, newValue: created, meta });
      return created;
    });
  }

  async updateRule(actor: AuthUser, id: string, input: Partial<RuleInput>, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const { rows: cur } = await tx.query('SELECT * FROM quality_settings WHERE id = $1 FOR UPDATE', [id]);
      if (!cur[0]) throw new NotFoundError('Quality rule', id);
      const before = camelize<RuleInput & { isActive: boolean }>(cur[0]);
      const n = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) } as RuleInput & { isActive: boolean };
      const { rows } = await tx.query(
        `UPDATE quality_settings SET name = $2, metric = $3, operator = $4, threshold = $5, action = $6, description = $7, is_active = $8
          WHERE id = $1 RETURNING *`,
        [id, n.name, n.metric, n.operator, n.threshold, n.action, n.description ?? null, n.isActive],
      );
      const after = camelize(rows[0]);
      await this.audit.record(tx, { userId: actor.id, action: 'UPDATE', module: 'quality', entityType: 'QualityRule', entityId: id, previousValue: before, newValue: after, meta });
      return after;
    });
  }

  // ------------------------------------------------------------------ grades & coffee types

  async assertGrade(db: pg.Pool | pg.PoolClient, id: string, stage?: 'CHERRY' | 'PARCHMENT'): Promise<void> {
    const { rows } = await db.query('SELECT stage, is_active FROM coffee_grades WHERE id = $1', [id]);
    if (!rows[0]) throw new NotFoundError('Grade', id);
    if (!rows[0].is_active) throw new BusinessRuleError('GRADE_INACTIVE', 'The grade is not active');
    if (stage && rows[0].stage !== stage) throw new BusinessRuleError('GRADE_WRONG_STAGE', `A ${stage.toLowerCase()} grade is required here`);
  }

  async listGrades(filter: { stage?: string; active?: boolean }) {
    const w = new Where().addIf(filter.stage, 'stage = ?').addIf(filter.active, 'is_active = ?');
    const { rows } = await this.pool.query(`SELECT * FROM coffee_grades ${w.sql} ORDER BY stage, sort_order, code`, w.args);
    return camelizeRows(rows);
  }

  async createGrade(actor: AuthUser, input: { code: string; name: string; stage: 'CHERRY' | 'PARCHMENT'; sortOrder?: number }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query(
        'INSERT INTO coffee_grades (code, name, stage, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
        [input.code.trim().toUpperCase(), input.name.trim(), input.stage, input.sortOrder ?? 0],
      );
      await this.audit.record(tx, { userId: actor.id, action: 'CREATE', module: 'quality', entityType: 'CoffeeGrade', entityId: rows[0].id, newValue: rows[0], meta });
      return camelize(rows[0]);
    });
  }

  async updateGrade(actor: AuthUser, id: string, input: { name?: string; sortOrder?: number; isActive?: boolean }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const { rows: cur } = await tx.query('SELECT * FROM coffee_grades WHERE id = $1 FOR UPDATE', [id]);
      if (!cur[0]) throw new NotFoundError('Grade', id);
      const { rows } = await tx.query(
        `UPDATE coffee_grades SET name = COALESCE($2, name), sort_order = COALESCE($3, sort_order), is_active = COALESCE($4, is_active)
          WHERE id = $1 RETURNING *`,
        [id, input.name?.trim() ?? null, input.sortOrder ?? null, input.isActive ?? null],
      );
      await this.audit.record(tx, { userId: actor.id, action: 'UPDATE', module: 'quality', entityType: 'CoffeeGrade', entityId: id, previousValue: cur[0], newValue: rows[0], meta });
      return camelize(rows[0]);
    });
  }

  async listCoffeeTypes(active?: boolean) {
    const w = new Where().addIf(active, 'is_active = ?');
    const { rows } = await this.pool.query(`SELECT * FROM coffee_types ${w.sql} ORDER BY code`, w.args);
    return camelizeRows(rows);
  }

  async createCoffeeType(actor: AuthUser, input: { code: string; name: string }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query('INSERT INTO coffee_types (code, name) VALUES ($1,$2) RETURNING *', [input.code.trim().toUpperCase(), input.name.trim()]);
      await this.audit.record(tx, { userId: actor.id, action: 'CREATE', module: 'quality', entityType: 'CoffeeType', entityId: rows[0].id, newValue: rows[0], meta });
      return camelize(rows[0]);
    });
  }

  async updateCoffeeType(actor: AuthUser, id: string, input: { name?: string; isActive?: boolean }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const { rows: cur } = await tx.query('SELECT * FROM coffee_types WHERE id = $1 FOR UPDATE', [id]);
      if (!cur[0]) throw new NotFoundError('Coffee type', id);
      const { rows } = await tx.query(
        'UPDATE coffee_types SET name = COALESCE($2, name), is_active = COALESCE($3, is_active) WHERE id = $1 RETURNING *',
        [id, input.name?.trim() ?? null, input.isActive ?? null],
      );
      await this.audit.record(tx, { userId: actor.id, action: 'UPDATE', module: 'quality', entityType: 'CoffeeType', entityId: id, previousValue: cur[0], newValue: rows[0], meta });
      return camelize(rows[0]);
    });
  }
}
