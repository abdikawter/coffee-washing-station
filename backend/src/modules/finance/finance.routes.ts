import type pg from 'pg';
import { z } from 'zod';
import type { AuditLogService } from '../../core/audit-log/audit-log.service.js';
import type { CashLedgerService } from '../../core/cash-ledger/cash-ledger.service.js';
import { camelizeRows, withTransaction } from '../../db/pool.js';
import { Where } from '../../db/where.js';
import type { Api } from '../../http/api.js';
import { isoDateTime, list, moneyString, orderBy, pageClause, pagination, single } from '../../http/schemas.js';

const TXN_TYPES = ['CASH_FUNDING', 'SUPPLIER_PAYMENT', 'PAYROLL_PAYMENT', 'EXPENSE_PAYMENT', 'CASH_RETURN', 'REVERSAL'] as const;

const cashTxnSchema = z
  .object({
    id: z.uuid(), txnNumber: z.string(), txnDate: z.date(), direction: z.enum(['IN', 'OUT']), type: z.enum(TXN_TYPES), amount: z.string(),
    description: z.string(), paymentId: z.uuid().nullable(), payrollId: z.uuid().nullable(), expenseId: z.uuid().nullable(),
    reversalOfId: z.uuid().nullable(), cashierId: z.uuid(), cashierName: z.string().optional(), createdAt: z.date(),
  })
  .meta({ id: 'CashTransaction' });

/**
 * Cash ledger (Phase 2 part of the finance module): list, cash on hand, and
 * manual funding / return entries. Expenses and period summaries are Phase 7.
 */
export function registerFinanceRoutes(api: Api, pool: pg.Pool, cash: CashLedgerService, audit: AuditLogService): void {
  api.route('Finance', {
    method: 'get', path: '/finance/cash', summary: 'Cash ledger entries',
    access: { permission: 'cash:read' },
    query: pagination(['txnDate'] as const, '-txnDate').extend({
      type: z.enum(TXN_TYPES).optional(), direction: z.enum(['IN', 'OUT']).optional(),
      from: isoDateTime.optional(), to: isoDateTime.optional(),
    }).strict(),
    response: { status: 200, description: 'Page of cash entries', schema: list(cashTxnSchema) },
    handler: async ({ query }) => {
      const w = new Where().addIf(query.type, 'c.type = ?').addIf(query.direction, 'c.direction = ?')
        .addIf(query.from, 'c.txn_date >= ?').addIf(query.to, 'c.txn_date < ?');
      const { limit, offset } = pageClause(query);
      const [rows, count] = await Promise.all([
        pool.query(
          `SELECT c.*, u.full_name AS cashier_name FROM cash_transactions c JOIN users u ON u.id = c.cashier_id ${w.sql}
            ORDER BY ${orderBy(query.sort, { txnDate: 'c.txn_date' })}, c.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
          w.args,
        ),
        pool.query(`SELECT count(*)::int AS n FROM cash_transactions c ${w.sql}`, w.args),
      ]);
      return { data: camelizeRows(rows.rows), meta: { page: query.page, pageSize: query.pageSize, total: count.rows[0].n } };
    },
  });

  api.route('Finance', {
    method: 'get', path: '/finance/cash/summary', summary: 'Cash on hand and today\'s movements',
    access: { permission: 'cash:read' },
    response: {
      status: 200, description: 'Summary',
      schema: single(z.object({ balance: z.string(), inToday: z.string(), outToday: z.string() })),
    },
    handler: async () => {
      const { rows } = await pool.query(
        `SELECT COALESCE(sum(amount) FILTER (WHERE direction = 'IN' AND txn_date >= date_trunc('day', now())), 0)::numeric(14,2)::text AS in_today,
                COALESCE(sum(amount) FILTER (WHERE direction = 'OUT' AND txn_date >= date_trunc('day', now())), 0)::numeric(14,2)::text AS out_today
           FROM cash_transactions`,
      );
      return { data: { balance: await cash.balance(pool), inToday: rows[0].in_today, outToday: rows[0].out_today } };
    },
  });

  api.route('Finance', {
    method: 'post', path: '/finance/cash', summary: 'Record cash funding (IN) or a cash return (OUT)',
    access: { permission: 'cash:record' }, idempotent: true,
    body: z.object({
      type: z.enum(['CASH_FUNDING', 'CASH_RETURN']), amount: moneyString, description: z.string().trim().min(3).max(500),
    }).strict(),
    response: { status: 201, description: 'Recorded', schema: single(cashTxnSchema) },
    handler: async ({ body, user, meta }) =>
      ({
        data: await withTransaction(pool, async (tx) => {
          const t = await cash.post(tx, { ...body, direction: body.type === 'CASH_FUNDING' ? 'IN' : 'OUT', cashierId: user.id });
          await audit.record(tx, { userId: user.id, action: 'CREATE', module: 'finance', entityType: 'CashTransaction', entityId: t.id, newValue: t, meta });
          return t;
        }),
      }),
  });
}
