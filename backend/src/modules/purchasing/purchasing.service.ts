import type pg from 'pg';
import { assertAcceptableEntryTime } from '../../common/business-time.js';
import { Decimal, type RoundingMode } from '../../common/decimal.js';
import { BusinessRuleError, NotFoundError, StaleVersionError, ValidationError } from '../../common/errors.js';
import { businessDate } from '../../common/util.js';
import type { AuditAction, AuditLogService } from '../../core/audit-log/audit-log.service.js';
import type { LotService } from '../../core/lots/lot.service.js';
import type { OutboxService } from '../../core/outbox/outbox.service.js';
import type { SequenceService } from '../../core/sequences/sequence.service.js';
import type { SettingsService } from '../../core/settings/settings.service.js';
import { camelize, camelizeRows, withTransaction } from '../../db/pool.js';
import { Where } from '../../db/where.js';
import { orderBy, pageClause, type PageQuery } from '../../http/schemas.js';
import type { AuthUser, RequestMeta } from '../../http/types.js';
import type { ScalesService } from '../equipment/scales.service.js';
import { computeVoucher } from './domain/purchase-calculator.js';
import { nextVoucherStatus, type VoucherCommand, type VoucherStatus } from './domain/voucher-state-machine.js';

export interface WeighingInput {
  scaleId: string;
  grossKg: string;
  tareKg?: string;
  weighedAt?: string;
}

export interface VoucherItemInput {
  coffeeTypeId?: string;
  qualityGradeId?: string | null;
  pricePerKg?: string;
  weighings: WeighingInput[];
}

export interface VoucherInput {
  qualityInspectionId: string;
  coffeeTypeId: string;
  qualityGradeId?: string | null;
  pricePerKg: string;
  voucherDate?: string;
  weighingClerkId?: string;
  items: VoucherItemInput[];
}

/** The voucher row fields services act on (camelCase). */
export interface VoucherRow {
  id: string;
  voucherNo: string;
  voucherDate: string;
  supplierId: string;
  supplierNameSnap: string;
  totalWeightKg: string;
  totalAmount: string;
  status: VoucherStatus;
  createdById: string;
  weighingClerkId: string;
  qualityInspectorId: string;
  verifiedById: string | null;
  approvedById: string | null;
  cashierId: string | null;
  version: number;
}

export type VoucherCommandName = Extract<VoucherCommand, 'submit' | 'verify' | 'return' | 'approve' | 'cancel' | 'void'>;

const AUDIT_ACTION: Record<VoucherCommandName, AuditAction> = {
  submit: 'SUBMIT', verify: 'VERIFY', return: 'UPDATE', approve: 'APPROVE', cancel: 'CANCEL', void: 'VOID',
};

const LIST_SELECT = `
  SELECT pv.id, pv.voucher_no, pv.voucher_date, pv.supplier_id, s.supplier_code, pv.supplier_name_snap AS supplier_name,
         pv.total_weight_kg, pv.price_per_kg, pv.total_amount, pv.status, pv.scale_warning, pv.created_at, pv.version,
         l.lot_number
    FROM purchase_vouchers pv
    JOIN suppliers s ON s.id = pv.supplier_id
    LEFT JOIN lots l ON l.purchase_voucher_id = pv.id`;

const SORT = { voucherDate: 'pv.voucher_date', voucherNo: 'pv.voucher_no', totalAmount: 'pv.total_amount', createdAt: 'pv.created_at' };

/**
 * Purchase vouchers (ARCHITECTURE.md §9.1 "Weighing + voucher draft" … "Approve").
 * Totals are always computed here; every state change locks the voucher row and
 * checks its optimistic version.
 */
export class PurchasingService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsService,
    private readonly sequences: SequenceService,
    private readonly scales: ScalesService,
    private readonly lots: LotService,
    private readonly outbox: OutboxService,
  ) {}

  // ------------------------------------------------------------------ queries

  async list(q: PageQuery & { status?: VoucherStatus; supplierId?: string; from?: string; to?: string; search?: string }) {
    const w = new Where()
      .addIf(q.status, 'pv.status = ?')
      .addIf(q.supplierId, 'pv.supplier_id = ?')
      .addIf(q.from, 'pv.voucher_date >= ?')
      .addIf(q.to, 'pv.voucher_date <= ?')
      .addIf(q.search, '(pv.voucher_no ILIKE ? OR pv.supplier_name_snap ILIKE ? OR s.supplier_code ILIKE ?)', q.search && `%${q.search}%`);
    const { limit, offset } = pageClause(q);
    const [rows, count] = await Promise.all([
      this.pool.query(`${LIST_SELECT} ${w.sql} ORDER BY ${orderBy(q.sort, SORT)}, pv.id DESC LIMIT ${limit} OFFSET ${offset}`, w.args),
      this.pool.query(`SELECT count(*)::int AS n FROM purchase_vouchers pv JOIN suppliers s ON s.id = pv.supplier_id ${w.sql}`, w.args),
    ]);
    return { data: camelizeRows(rows.rows), total: count.rows[0].n as number };
  }

  /**
   * Dashboard figures (station timezone): today's and yesterday's purchases, the
   * amount paid out today, vouchers per status and the last 14 days per day.
   * Cancelled and voided vouchers never count as bought.
   */
  async summary() {
    const tz = await this.settings.get<string>('station.timezone');
    const today = businessDate(new Date(), tz);
    const live = `status NOT IN ('CANCELLED', 'VOIDED')`;
    const [totals, paid, daily] = await Promise.all([
      this.pool.query(
        `SELECT count(*) FILTER (WHERE voucher_date = $1 AND ${live})::int AS today_vouchers,
                COALESCE(sum(total_weight_kg) FILTER (WHERE voucher_date = $1 AND ${live}), 0)::numeric(14,3)::text AS today_kg,
                COALESCE(sum(total_amount) FILTER (WHERE voucher_date = $1 AND ${live}), 0)::numeric(14,2)::text AS today_amount,
                COALESCE(sum(total_weight_kg) FILTER (WHERE voucher_date = $1::date - 1 AND ${live}), 0)::numeric(14,3)::text AS yesterday_kg,
                COALESCE(sum(total_amount) FILTER (WHERE voucher_date = $1::date - 1 AND ${live}), 0)::numeric(14,2)::text AS yesterday_amount,
                count(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
                count(*) FILTER (WHERE status = 'PENDING_VERIFICATION')::int AS pending_verification,
                count(*) FILTER (WHERE status = 'VERIFIED')::int AS verified,
                count(*) FILTER (WHERE status = 'APPROVED')::int AS approved
           FROM purchase_vouchers`,
        [today],
      ),
      this.pool.query(
        `SELECT COALESCE(sum(amount), 0)::numeric(14,2)::text AS paid_today_amount, count(*)::int AS paid_today_count
           FROM supplier_payments WHERE status = 'PAID' AND (paid_at AT TIME ZONE $2)::date = $1`,
        [today, tz],
      ),
      this.pool.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS date,
                COALESCE(sum(pv.total_weight_kg), 0)::numeric(14,3)::text AS kg,
                COALESCE(sum(pv.total_amount), 0)::numeric(14,2)::text AS amount,
                (sum(pv.total_amount) / NULLIF(sum(pv.total_weight_kg), 0))::numeric(14,2)::text AS avg_price_per_kg
           FROM generate_series($1::date - 13, $1::date, interval '1 day') AS d
           LEFT JOIN purchase_vouchers pv ON pv.voucher_date = d::date AND pv.${live}
          GROUP BY d ORDER BY d`,
        [today],
      ),
    ]);
    return {
      date: today,
      ...camelize<Record<string, number | string>>(totals.rows[0]),
      ...camelize<Record<string, number | string>>(paid.rows[0]),
      daily: camelizeRows(daily.rows) as { date: string; kg: string; amount: string; avgPricePerKg: string | null }[],
    };
  }

  async get(id: string, db: pg.Pool | pg.PoolClient = this.pool) {
    const { rows } = await db.query(
      `SELECT pv.*, s.supplier_code, ct.name AS coffee_type_name, g.code AS grade_code, qi.inspection_no,
              cu.full_name AS created_by_name, wu.full_name AS weighing_clerk_name, iu.full_name AS quality_inspector_name,
              vu.full_name AS verified_by_name, au.full_name AS approved_by_name, cau.full_name AS cashier_name
         FROM purchase_vouchers pv
         JOIN suppliers s ON s.id = pv.supplier_id
         JOIN coffee_types ct ON ct.id = pv.coffee_type_id
         JOIN quality_inspections qi ON qi.id = pv.quality_inspection_id
         LEFT JOIN coffee_grades g ON g.id = pv.quality_grade_id
         JOIN users cu ON cu.id = pv.created_by_id
         JOIN users wu ON wu.id = pv.weighing_clerk_id
         JOIN users iu ON iu.id = pv.quality_inspector_id
         LEFT JOIN users vu ON vu.id = pv.verified_by_id
         LEFT JOIN users au ON au.id = pv.approved_by_id
         LEFT JOIN users cau ON cau.id = pv.cashier_id
        WHERE pv.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundError('Purchase voucher', id);
    // Sequential on purpose: `db` may be a transaction client, which runs one query at a time.
    const items = await db.query(
      `SELECT pi.*, ct.name AS coffee_type_name, g.code AS grade_code FROM purchase_items pi
         JOIN coffee_types ct ON ct.id = pi.coffee_type_id LEFT JOIN coffee_grades g ON g.id = pi.quality_grade_id
        WHERE pi.voucher_id = $1 ORDER BY pi.line_no`,
      [id],
    );
    const weighings = await db.query(
      `SELECT wr.*, e.code AS scale_code FROM weight_records wr
         JOIN purchase_items pi ON pi.id = wr.purchase_item_id
         JOIN scales sc ON sc.id = wr.scale_id JOIN equipment e ON e.id = sc.equipment_id
        WHERE pi.voucher_id = $1 ORDER BY wr.weighed_at, wr.created_at`,
      [id],
    );
    const lot = await db.query('SELECT id, lot_number, current_stage, status FROM lots WHERE purchase_voucher_id = $1', [id]);
    const payments = await db.query(
      'SELECT id, payment_no, amount, status, method, paid_at, created_at FROM supplier_payments WHERE voucher_id = $1 ORDER BY created_at',
      [id],
    );
    const ws = camelizeRows<{ purchaseItemId: string }>(weighings.rows);
    return {
      ...camelize<VoucherRow & Record<string, unknown>>(rows[0]),
      items: camelizeRows<{ id: string }>(items.rows).map((i) => ({ ...i, weighings: ws.filter((w) => w.purchaseItemId === i.id) })),
      lot: lot.rows[0] ? camelize(lot.rows[0]) : null,
      payments: camelizeRows(payments.rows),
    };
  }

  /** Locks the voucher row for a state change and checks the optimistic version. */
  async lock(tx: pg.PoolClient, id: string, version?: number): Promise<VoucherRow> {
    const { rows } = await tx.query('SELECT * FROM purchase_vouchers WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw new NotFoundError('Purchase voucher', id);
    const v = camelize<VoucherRow>(rows[0]);
    if (version !== undefined && v.version !== version) throw new StaleVersionError('Purchase voucher');
    return v;
  }

  // ------------------------------------------------------------------ draft

  /**
   * Validates a draft and computes every total server-side:
   * inspection ACCEPTED, unused, supplier ACTIVE; each weighing on a scale verified
   * within scale.verificationFrequencyHours, else scale.unverifiedPolicy (BLOCK → 422,
   * WARN → allowed and flagged); net = gross − tare; amount = weight × price/kg.
   */
  private async prepareDraft(tx: pg.PoolClient, actor: AuthUser, input: VoucherInput, voucherId?: string) {
    const { rows: qi } = await tx.query(
      `SELECT qi.id, qi.decision, qi.supplier_id, qi.inspector_id, qi.quality_grade_id, s.full_name, s.phone, s.status AS supplier_status,
              (SELECT id FROM purchase_vouchers WHERE quality_inspection_id = qi.id) AS used_by
         FROM quality_inspections qi JOIN suppliers s ON s.id = qi.supplier_id WHERE qi.id = $1 FOR UPDATE OF qi`,
      [input.qualityInspectionId],
    );
    const insp = qi[0];
    if (!insp) throw new NotFoundError('Quality inspection', input.qualityInspectionId);
    if (insp.decision !== 'ACCEPTED') throw new BusinessRuleError('INSPECTION_NOT_ACCEPTED', 'The quality inspection rejected this cherry');
    if (insp.used_by && insp.used_by !== voucherId) {
      throw new BusinessRuleError('INSPECTION_ALREADY_USED', 'This inspection is already used by another voucher', { voucherId: insp.used_by });
    }
    if (insp.supplier_status !== 'ACTIVE') throw new BusinessRuleError('SUPPLIER_NOT_ACTIVE', 'The supplier is not ACTIVE', { status: insp.supplier_status });

    const typeIds = [...new Set([input.coffeeTypeId, ...input.items.map((i) => i.coffeeTypeId).filter((x): x is string => !!x)])];
    const types = await tx.query('SELECT id FROM coffee_types WHERE id = ANY($1) AND is_active', [typeIds]);
    if (types.rowCount !== typeIds.length) throw new BusinessRuleError('COFFEE_TYPE_INVALID', 'Unknown or inactive coffee type');
    const gradeIds = [...new Set([input.qualityGradeId, ...input.items.map((i) => i.qualityGradeId)].filter((x): x is string => !!x))];
    if (gradeIds.length) {
      const g = await tx.query(`SELECT id FROM coffee_grades WHERE id = ANY($1) AND is_active AND stage = 'CHERRY'`, [gradeIds]);
      if (g.rowCount !== gradeIds.length) throw new BusinessRuleError('GRADE_INVALID', 'Grades on a purchase must be active cherry grades');
    }

    const weighingClerkId = input.weighingClerkId ?? actor.id;
    if (weighingClerkId !== actor.id) {
      const clerk = await tx.query(`SELECT status FROM users WHERE id = $1`, [weighingClerkId]);
      if (clerk.rows[0]?.status !== 'ACTIVE') throw new BusinessRuleError('WEIGHING_CLERK_INVALID', 'The weighing clerk must be an active user');
    }

    const maxBackdate = await this.settings.getIn<number>(tx, 'ops.maxBackdateHours');
    const policy = await this.settings.getIn<'BLOCK' | 'WARN'>(tx, 'scale.unverifiedPolicy');
    const rounding = await this.settings.getIn<RoundingMode>(tx, 'finance.roundingMode');
    const tz = await this.settings.getIn<string>(tx, 'station.timezone');
    const now = new Date();
    const voucherDate = input.voucherDate ?? businessDate(now, tz);
    if (voucherDate > businessDate(now, tz)) throw new BusinessRuleError('FUTURE_DATED', 'The voucher date cannot be in the future');
    if (voucherDate < businessDate(new Date(now.getTime() - maxBackdate * 3_600_000), tz)) {
      throw new BusinessRuleError('BACKDATE_LIMIT_EXCEEDED', `The voucher date is older than the allowed ${maxBackdate} h (ops.maxBackdateHours)`);
    }

    const warnings: string[] = [];
    const weighingMeta: { scaleId: string; weighedAt: Date; verified: boolean }[][] = [];
    for (const [i, item] of input.items.entries()) {
      const metas: { scaleId: string; weighedAt: Date; verified: boolean }[] = [];
      for (const [j, w] of item.weighings.entries()) {
        const weighedAt = w.weighedAt ? new Date(w.weighedAt) : now;
        assertAcceptableEntryTime(weighedAt, maxBackdate, now, `items.${i}.weighings.${j}.weighedAt`);
        const state = await this.scales.verificationAt(tx, w.scaleId, weighedAt);
        if (new Decimal(w.grossKg).gt(state.capacityKg)) {
          throw new BusinessRuleError('SCALE_CAPACITY_EXCEEDED', `Scale ${state.code} capacity is ${state.capacityKg} kg`, { item: i + 1, weighing: j + 1 });
        }
        if (!state.verified) {
          if (policy === 'BLOCK' || state.reason === 'OUT_OF_SERVICE' || state.reason === 'LAST_CHECK_FAILED') {
            throw new BusinessRuleError('SCALE_NOT_VERIFIED', `Scale ${state.code} has no valid verification (${state.reason})`, {
              scaleId: w.scaleId, reason: state.reason, policy, item: i + 1, weighing: j + 1,
            });
          }
          warnings.push(`Scale ${state.code} not verified (${state.reason}) at ${weighedAt.toISOString()}`);
        }
        metas.push({ scaleId: w.scaleId, weighedAt, verified: state.verified });
      }
      weighingMeta.push(metas);
    }

    const computed = computeVoucher(
      input.items.map((it) => ({ pricePerKg: it.pricePerKg ?? input.pricePerKg, weighings: it.weighings.map((w) => ({ grossKg: w.grossKg, tareKg: w.tareKg ?? '0' })) })),
      rounding,
    );
    return { insp, weighingClerkId, voucherDate, warnings: [...new Set(warnings)], weighingMeta, computed };
  }

  private async insertLines(tx: pg.PoolClient, voucherId: string, input: VoucherInput, d: Awaited<ReturnType<PurchasingService['prepareDraft']>>) {
    for (const [i, item] of d.computed.items.entries()) {
      const src = input.items[i]!;
      const { rows } = await tx.query(
        `INSERT INTO purchase_items (voucher_id, line_no, coffee_type_id, quality_grade_id, weight_kg, price_per_kg, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [voucherId, item.lineNo, src.coffeeTypeId ?? input.coffeeTypeId, src.qualityGradeId ?? input.qualityGradeId ?? null, item.weightKg, item.pricePerKg, item.amount],
      );
      for (const [j, w] of item.weighings.entries()) {
        const m = d.weighingMeta[i]![j]!;
        await tx.query(
          `INSERT INTO weight_records (purchase_item_id, scale_id, gross_kg, tare_kg, net_kg, weighed_by_id, weighed_at, scale_verified)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [rows[0].id, m.scaleId, w.grossKg, w.tareKg, w.netKg, d.weighingClerkId, m.weighedAt, m.verified],
        );
      }
    }
  }

  async create(actor: AuthUser, input: VoucherInput, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const d = await this.prepareDraft(tx, actor, input);
      const voucherNo = await this.sequences.next(tx, 'PV');
      const { rows } = await tx.query(
        `INSERT INTO purchase_vouchers (voucher_no, voucher_date, supplier_id, supplier_name_snap, supplier_phone_snap, coffee_type_id,
                                        quality_inspection_id, quality_grade_id, total_weight_kg, price_per_kg, total_amount, scale_warning,
                                        created_by_id, weighing_clerk_id, quality_inspector_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [voucherNo, d.voucherDate, d.insp.supplier_id, d.insp.full_name, d.insp.phone, input.coffeeTypeId, input.qualityInspectionId,
          input.qualityGradeId ?? d.insp.quality_grade_id ?? null, d.computed.totalWeightKg, input.pricePerKg, d.computed.totalAmount,
          d.warnings.length ? d.warnings.join('; ') : null, actor.id, d.weighingClerkId, d.insp.inspector_id],
      );
      const id = rows[0].id as string;
      await this.insertLines(tx, id, input, d);
      if (d.warnings.length) {
        await this.outbox.emit(tx, { eventType: 'purchase.unverified-scale', aggregate: 'PurchaseVoucher', aggregateId: id, payload: { voucherNo, warnings: d.warnings } });
      }
      await this.audit.record(tx, {
        userId: actor.id, action: 'CREATE', module: 'purchasing', entityType: 'PurchaseVoucher', entityId: id,
        newValue: { voucherNo, totalWeightKg: d.computed.totalWeightKg, totalAmount: d.computed.totalAmount, scaleWarning: d.warnings }, meta,
      });
      return this.get(id, tx);
    });
  }

  async update(actor: AuthUser, id: string, input: VoucherInput & { version: number }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const v = await this.lock(tx, id, input.version);
      nextVoucherStatus(v.status, 'update');
      const before = await this.get(id, tx);
      const d = await this.prepareDraft(tx, actor, input, id);
      await tx.query('DELETE FROM purchase_items WHERE voucher_id = $1', [id]);
      await tx.query(
        `UPDATE purchase_vouchers SET voucher_date = $2, supplier_id = $3, supplier_name_snap = $4, supplier_phone_snap = $5, coffee_type_id = $6,
                quality_inspection_id = $7, quality_grade_id = $8, total_weight_kg = $9, price_per_kg = $10, total_amount = $11,
                scale_warning = $12, weighing_clerk_id = $13, quality_inspector_id = $14, version = version + 1
          WHERE id = $1`,
        [id, d.voucherDate, d.insp.supplier_id, d.insp.full_name, d.insp.phone, input.coffeeTypeId, input.qualityInspectionId,
          input.qualityGradeId ?? d.insp.quality_grade_id ?? null, d.computed.totalWeightKg, input.pricePerKg, d.computed.totalAmount,
          d.warnings.length ? d.warnings.join('; ') : null, d.weighingClerkId, d.insp.inspector_id],
      );
      await this.insertLines(tx, id, input, d);
      await this.audit.record(tx, {
        userId: actor.id, action: 'UPDATE', module: 'purchasing', entityType: 'PurchaseVoucher', entityId: id,
        previousValue: { totalWeightKg: before.totalWeightKg, totalAmount: before.totalAmount, items: before.items.length },
        newValue: { totalWeightKg: d.computed.totalWeightKg, totalAmount: d.computed.totalAmount, items: d.computed.items.length }, meta,
      });
      return this.get(id, tx);
    });
  }

  // ------------------------------------------------------------------ commands

  async command(actor: AuthUser, id: string, cmd: VoucherCommandName, input: { version: number; reason?: string }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const v = await this.lock(tx, id, input.version);
      const to = nextVoucherStatus(v.status, cmd);
      const set: string[] = ['status = $2', 'version = version + 1'];
      const args: unknown[] = [id, to];
      const push = (col: string, value: unknown) => { args.push(value); set.push(`${col} = $${args.length}`); };
      let lot: { id: string; lotNumber: string } | null = null;

      if ((cmd === 'return' || cmd === 'cancel' || cmd === 'void') && !input.reason) {
        throw new ValidationError([{ location: 'body', path: 'reason', message: `a reason is required to ${cmd} a voucher` }]);
      }
      switch (cmd) {
        case 'submit': {
          const n = await tx.query('SELECT count(*)::int AS n FROM purchase_items WHERE voucher_id = $1', [id]);
          if (n.rows[0].n === 0) throw new BusinessRuleError('NO_ITEMS', 'A voucher needs at least one item');
          push('submitted_at', new Date());
          break;
        }
        case 'verify':
          push('verified_by_id', actor.id);
          push('verified_at', new Date());
          break;
        case 'return':
          set.push('submitted_at = NULL', 'verified_by_id = NULL', 'verified_at = NULL');
          break;
        case 'approve':
          push('approved_by_id', actor.id);
          push('approved_at', new Date());
          break;
        case 'cancel':
        case 'void':
          if (cmd === 'void') await this.assertVoidable(tx, id);
          push('cancelled_by_id', actor.id);
          push('cancelled_at', new Date());
          push('cancel_reason', input.reason);
          break;
      }
      await tx.query(`UPDATE purchase_vouchers SET ${set.join(', ')} WHERE id = $1`, args);

      if (cmd === 'approve' && (await this.settings.getIn<string>(tx, 'purchase.lotCreationTrigger')) === 'ON_APPROVAL') {
        lot = await this.lots.createRootLot(tx, v, actor.id);
      }
      if (cmd === 'void') await tx.query(`UPDATE lots SET status = 'CLOSED' WHERE purchase_voucher_id = $1`, [id]);

      await this.outbox.emit(tx, { eventType: `purchase.${cmd}`, aggregate: 'PurchaseVoucher', aggregateId: id, payload: { voucherNo: v.voucherNo, from: v.status, to } });
      await this.audit.record(tx, {
        userId: actor.id, action: AUDIT_ACTION[cmd], module: 'purchasing', entityType: 'PurchaseVoucher', entityId: id,
        previousValue: { status: v.status, version: v.version },
        newValue: { status: to, command: cmd, reason: input.reason ?? null, lotNumber: lot?.lotNumber ?? null }, meta,
      });
      return this.get(id, tx);
    });
  }

  /** Void: no live payment, and the lot (if any) has not left the PURCHASED stage (§9.2). */
  private async assertVoidable(tx: pg.PoolClient, voucherId: string): Promise<void> {
    const pay = await tx.query(`SELECT payment_no, status FROM supplier_payments WHERE voucher_id = $1 AND status IN ('PENDING_APPROVAL', 'APPROVED', 'PAID')`, [voucherId]);
    if (pay.rows[0]) {
      throw new BusinessRuleError('VOUCHER_HAS_LIVE_PAYMENT', 'Reject or reverse the payment before voiding the voucher', {
        paymentNo: pay.rows[0].payment_no, paymentStatus: pay.rows[0].status,
      });
    }
    const lot = await tx.query('SELECT lot_number, current_stage FROM lots WHERE purchase_voucher_id = $1 FOR UPDATE', [voucherId]);
    if (lot.rows[0] && lot.rows[0].current_stage !== 'PURCHASED') {
      throw new BusinessRuleError('LOT_IN_PROCESSING', 'The lot is already in processing; raise a corrective action instead of voiding', {
        lotNumber: lot.rows[0].lot_number, stage: lot.rows[0].current_stage,
      });
    }
  }

  /**
   * Called by payments inside their transaction: disbursement marks the voucher
   * PAID (paying cashier recorded); reversal returns it to APPROVED.
   */
  async markPaid(tx: pg.PoolClient, voucherId: string, cashierId: string): Promise<VoucherRow> {
    const v = await this.lock(tx, voucherId);
    const to = nextVoucherStatus(v.status, 'pay');
    await tx.query('UPDATE purchase_vouchers SET status = $2, cashier_id = $3, version = version + 1 WHERE id = $1', [voucherId, to, cashierId]);
    return v;
  }

  async unmarkPaid(tx: pg.PoolClient, voucherId: string): Promise<VoucherRow> {
    const v = await this.lock(tx, voucherId);
    const to = nextVoucherStatus(v.status, 'reversePayment');
    await tx.query('UPDATE purchase_vouchers SET status = $2, cashier_id = NULL, version = version + 1 WHERE id = $1', [voucherId, to]);
    return v;
  }
}
