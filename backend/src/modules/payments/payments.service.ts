import type pg from 'pg';
import { BusinessRuleError, NotFoundError } from '../../common/errors.js';
import type { AuditAction, AuditLogService } from '../../core/audit-log/audit-log.service.js';
import type { CashLedgerService } from '../../core/cash-ledger/cash-ledger.service.js';
import type { LotService } from '../../core/lots/lot.service.js';
import type { OutboxService } from '../../core/outbox/outbox.service.js';
import type { SequenceService } from '../../core/sequences/sequence.service.js';
import type { SettingsService } from '../../core/settings/settings.service.js';
import { camelize, camelizeRows, withTransaction } from '../../db/pool.js';
import { Where } from '../../db/where.js';
import { orderBy, pageClause, type PageQuery } from '../../http/schemas.js';
import type { AuthUser, RequestMeta } from '../../http/types.js';
import type { PurchasingService } from '../purchasing/purchasing.service.js';
import { nextPaymentStatus, type PaymentCommand, type PaymentStatus } from './domain/payment-state-machine.js';

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHEQUE'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

interface PaymentRow {
  id: string;
  paymentNo: string;
  voucherId: string;
  amount: string;
  status: PaymentStatus;
  cashierId: string;
  approvedById: string | null;
}

const PAYMENT_SELECT = `
  SELECT p.*, pv.voucher_no, pv.supplier_name_snap AS supplier_name, s.supplier_code, pv.status AS voucher_status,
         cu.full_name AS cashier_name, au.full_name AS approved_by_name, l.lot_number
    FROM supplier_payments p
    JOIN purchase_vouchers pv ON pv.id = p.voucher_id
    JOIN suppliers s ON s.id = pv.supplier_id
    JOIN users cu ON cu.id = p.cashier_id
    LEFT JOIN users au ON au.id = p.approved_by_id
    LEFT JOIN lots l ON l.purchase_voucher_id = pv.id`;

const SORT = { createdAt: 'p.created_at', paymentDate: 'p.payment_date', amount: 'p.amount' };

/**
 * Supplier payments (ARCHITECTURE.md §9.1 "Payment"): one live payment per
 * voucher (DB partial unique index), amount = voucher total (no partial
 * payments).
 * Disbursement writes the cash ledger, marks the voucher PAID and — with
 * purchase.lotCreationTrigger = ON_PAYMENT — creates the lot, all in one transaction.
 */
export class PaymentsService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsService,
    private readonly sequences: SequenceService,
    private readonly cash: CashLedgerService,
    private readonly purchasing: PurchasingService,
    private readonly lots: LotService,
    private readonly outbox: OutboxService,
  ) {}

  async list(q: PageQuery & { status?: PaymentStatus; voucherId?: string; from?: string; to?: string }) {
    const w = new Where()
      .addIf(q.status, 'p.status = ?')
      .addIf(q.voucherId, 'p.voucher_id = ?')
      .addIf(q.from, 'p.payment_date >= ?')
      .addIf(q.to, 'p.payment_date < ?');
    const { limit, offset } = pageClause(q);
    const [rows, count] = await Promise.all([
      this.pool.query(`${PAYMENT_SELECT} ${w.sql} ORDER BY ${orderBy(q.sort, SORT)}, p.id DESC LIMIT ${limit} OFFSET ${offset}`, w.args),
      this.pool.query(`SELECT count(*)::int AS n FROM supplier_payments p ${w.sql}`, w.args),
    ]);
    return { data: camelizeRows(rows.rows), total: count.rows[0].n as number };
  }

  async get(id: string, db: pg.Pool | pg.PoolClient = this.pool) {
    const { rows } = await db.query(`${PAYMENT_SELECT} WHERE p.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundError('Payment', id);
    return camelize(rows[0]);
  }

  private async lock(tx: pg.PoolClient, id: string): Promise<PaymentRow> {
    const { rows } = await tx.query('SELECT * FROM supplier_payments WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw new NotFoundError('Payment', id);
    return camelize<PaymentRow>(rows[0]);
  }

  async create(actor: AuthUser, input: { voucherId: string; method: PaymentMethod; referenceNo?: string | null; paymentDate?: Date }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      // Locking the voucher serialises concurrent payment attempts; the partial unique index is the backstop.
      const v = await this.purchasing.lock(tx, input.voucherId);
      if (v.status !== 'APPROVED') {
        throw new BusinessRuleError('PAYMENT_BEFORE_APPROVAL', 'Payment cannot be processed before voucher approval', { voucherStatus: v.status });
      }
      const live = await tx.query(`SELECT payment_no FROM supplier_payments WHERE voucher_id = $1 AND status IN ('PENDING_APPROVAL', 'APPROVED', 'PAID')`, [v.id]);
      if (live.rows[0]) throw new BusinessRuleError('PAYMENT_ALREADY_EXISTS', 'This voucher already has a payment', { paymentNo: live.rows[0].payment_no });

      const requiresApproval = await this.settings.getIn<boolean>(tx, 'payment.requiresApproval');
      const paymentNo = await this.sequences.next(tx, 'PAY');
      const { rows } = await tx.query(
        `INSERT INTO supplier_payments (payment_no, voucher_id, amount, payment_date, method, reference_no, status, cashier_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [paymentNo, v.id, v.totalAmount, input.paymentDate ?? new Date(), input.method, input.referenceNo ?? null,
          requiresApproval ? 'PENDING_APPROVAL' : 'APPROVED', actor.id],
      );
      const id = rows[0].id as string;
      await this.outbox.emit(tx, { eventType: 'payment.created', aggregate: 'SupplierPayment', aggregateId: id, payload: { paymentNo, voucherNo: v.voucherNo, requiresApproval } });
      await this.audit.record(tx, {
        userId: actor.id, action: 'CREATE', module: 'payments', entityType: 'SupplierPayment', entityId: id,
        newValue: { paymentNo, voucherNo: v.voucherNo, amount: v.totalAmount, method: input.method, requiresApproval }, meta,
      });
      return this.get(id, tx);
    });
  }

  async command(actor: AuthUser, id: string, cmd: PaymentCommand, input: { reason?: string }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const p = await this.lock(tx, id);
      const to = nextPaymentStatus(p.status, cmd);
      let action: AuditAction = 'UPDATE';
      let lot: { id: string; lotNumber: string } | null = null;

      switch (cmd) {
        case 'approve':
        case 'reject':
          await tx.query(
            `UPDATE supplier_payments SET status = $2, approved_by_id = $3, approved_at = now(), reject_reason = $4 WHERE id = $1`,
            [id, to, actor.id, cmd === 'reject' ? input.reason : null],
          );
          action = cmd === 'approve' ? 'APPROVE' : 'REJECT';
          break;
        case 'disburse': {
          const v = await this.purchasing.markPaid(tx, p.voucherId, actor.id);
          await tx.query(`UPDATE supplier_payments SET status = $2, paid_at = now(), cashier_id = $3 WHERE id = $1`, [id, to, actor.id]);
          await this.cash.post(tx, {
            direction: 'OUT', type: 'SUPPLIER_PAYMENT', amount: p.amount, paymentId: id, cashierId: actor.id,
            description: `Payment ${p.paymentNo} for voucher ${v.voucherNo}`,
          });
          if ((await this.settings.getIn<string>(tx, 'purchase.lotCreationTrigger')) === 'ON_PAYMENT') {
            lot = await this.lots.createRootLot(tx, v, actor.id);
          }
          action = 'PAY';
          break;
        }
        case 'reverse': {
          const cashTxn = await tx.query(`SELECT id FROM cash_transactions WHERE payment_id = $1 AND type = 'SUPPLIER_PAYMENT' ORDER BY created_at LIMIT 1`, [id]);
          if (!cashTxn.rows[0]) throw new BusinessRuleError('CASH_ENTRY_MISSING', 'No cash entry found for this payment');
          await this.cash.reverse(tx, cashTxn.rows[0].id, actor.id, input.reason!);
          await this.purchasing.unmarkPaid(tx, p.voucherId);
          await tx.query(`UPDATE supplier_payments SET status = $2, reversal_reason = $3 WHERE id = $1`, [id, to, input.reason]);
          action = 'REVERSE';
          break;
        }
      }

      await this.outbox.emit(tx, { eventType: `payment.${cmd}`, aggregate: 'SupplierPayment', aggregateId: id, payload: { paymentNo: p.paymentNo, from: p.status, to } });
      await this.audit.record(tx, {
        userId: actor.id, action, module: 'payments', entityType: 'SupplierPayment', entityId: id,
        previousValue: { status: p.status },
        newValue: { status: to, command: cmd, reason: input.reason ?? null, lotNumber: lot?.lotNumber ?? null }, meta,
      });
      return this.get(id, tx);
    });
  }
}
