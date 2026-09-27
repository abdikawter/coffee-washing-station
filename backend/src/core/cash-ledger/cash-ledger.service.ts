import type pg from 'pg';
import { BusinessRuleError, NotFoundError } from '../../common/errors.js';
import { money } from '../../common/decimal.js';
import { camelize } from '../../db/pool.js';
import type { SequenceService } from '../sequences/sequence.service.js';

export type CashDirection = 'IN' | 'OUT';
export type CashTxnType = 'CASH_FUNDING' | 'SUPPLIER_PAYMENT' | 'PAYROLL_PAYMENT' | 'EXPENSE_PAYMENT' | 'CASH_RETURN' | 'REVERSAL';

export interface CashEntry {
  direction: CashDirection;
  type: CashTxnType;
  amount: string;
  description: string;
  cashierId: string;
  txnDate?: Date;
  paymentId?: string | null;
  payrollId?: string | null;
  expenseId?: string | null;
}

export interface CashTransaction {
  id: string;
  txnNumber: string;
  txnDate: Date;
  direction: CashDirection;
  type: CashTxnType;
  amount: string;
  description: string;
  paymentId: string | null;
  payrollId: string | null;
  expenseId: string | null;
  reversalOfId: string | null;
  cashierId: string;
  createdAt: Date;
}

/**
 * The only writer of `cash_transactions` (ARCHITECTURE.md §2.2). The table is
 * append-only (trigger, migration 0011): a mistake is corrected with a mirror
 * REVERSAL entry, which can exist only once per original (unique reversal_of_id).
 * Always called inside the caller's transaction.
 */
export class CashLedgerService {
  constructor(private readonly sequences: SequenceService) {}

  async post(tx: pg.PoolClient, e: CashEntry & { reversalOfId?: string | null }): Promise<CashTransaction> {
    const amount = money(e.amount);
    if (Number(amount) <= 0) throw new BusinessRuleError('INVALID_AMOUNT', 'Cash amounts must be greater than zero');
    const txnNumber = await this.sequences.next(tx, 'CASH');
    const { rows } = await tx.query(
      `INSERT INTO cash_transactions (txn_number, txn_date, direction, type, amount, description, payment_id, payroll_id,
                                      expense_id, reversal_of_id, cashier_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [txnNumber, e.txnDate ?? new Date(), e.direction, e.type, amount, e.description.slice(0, 500), e.paymentId ?? null,
        e.payrollId ?? null, e.expenseId ?? null, e.reversalOfId ?? null, e.cashierId],
    );
    return camelize<CashTransaction>(rows[0]);
  }

  /** Posts the mirror entry of `originalId` (opposite direction, type REVERSAL). */
  async reverse(tx: pg.PoolClient, originalId: string, cashierId: string, reason: string): Promise<CashTransaction> {
    const { rows } = await tx.query('SELECT * FROM cash_transactions WHERE id = $1', [originalId]);
    if (!rows[0]) throw new NotFoundError('Cash transaction', originalId);
    const original = camelize<CashTransaction>(rows[0]);
    if (original.type === 'REVERSAL') throw new BusinessRuleError('CANNOT_REVERSE_REVERSAL', 'A reversal entry cannot itself be reversed');
    return this.post(tx, {
      direction: original.direction === 'IN' ? 'OUT' : 'IN',
      type: 'REVERSAL',
      amount: original.amount,
      description: `Reversal of ${original.txnNumber}: ${reason}`,
      cashierId,
      paymentId: original.paymentId,
      payrollId: original.payrollId,
      expenseId: original.expenseId,
      reversalOfId: original.id,
    });
  }

  /** Cash on hand = Σ IN − Σ OUT. */
  async balance(db: pg.Pool | pg.PoolClient): Promise<string> {
    const { rows } = await db.query(
      `SELECT COALESCE(sum(CASE WHEN direction = 'IN' THEN amount ELSE -amount END), 0)::numeric(14,2)::text AS balance FROM cash_transactions`,
    );
    return rows[0].balance;
  }
}
