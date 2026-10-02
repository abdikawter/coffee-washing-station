import { z } from 'zod';
import type { Api } from '../../http/api.js';
import { isoDateTime, list, pagination, reasonSchema, single, uuidParam } from '../../http/schemas.js';
import { PAYMENT_STATUSES } from './domain/payment-state-machine.js';
import { PAYMENT_METHODS, type PaymentsService } from './payments.service.js';

const paymentSchema = z
  .object({
    id: z.uuid(), paymentNo: z.string(), voucherId: z.uuid(), voucherNo: z.string(), voucherStatus: z.string(),
    supplierCode: z.string(), supplierName: z.string(), lotNumber: z.string().nullable(),
    amount: z.string(), paymentDate: z.date(), method: z.enum(PAYMENT_METHODS), referenceNo: z.string().nullable(),
    status: z.enum(PAYMENT_STATUSES), cashierId: z.uuid(), cashierName: z.string(), approvedById: z.uuid().nullable(),
    approvedByName: z.string().nullable(), approvedAt: z.date().nullable(), paidAt: z.date().nullable(),
    rejectReason: z.string().nullable(), reversalReason: z.string().nullable(), createdAt: z.date(), updatedAt: z.date(),
  })
  .meta({ id: 'SupplierPayment' });

export function registerPaymentRoutes(api: Api, payments: PaymentsService): void {
  api.route('Payments', {
    method: 'get', path: '/payments', summary: 'List supplier payments (payment queue)',
    access: { permission: 'payment:read' },
    query: pagination(['createdAt', 'paymentDate', 'amount'] as const, '-createdAt').extend({
      status: z.enum(PAYMENT_STATUSES).optional(), voucherId: z.uuid().optional(),
      from: isoDateTime.optional(), to: isoDateTime.optional(),
    }).strict(),
    response: { status: 200, description: 'Page of payments', schema: list(paymentSchema) },
    handler: async ({ query }) => {
      const r = await payments.list(query);
      return { data: r.data, meta: { page: query.page, pageSize: query.pageSize, total: r.total } };
    },
  });

  api.route('Payments', {
    method: 'get', path: '/payments/:id', summary: 'Get a payment',
    access: { permission: 'payment:read' }, params: uuidParam,
    response: { status: 200, description: 'Payment', schema: single(paymentSchema) },
    handler: async ({ params }) => ({ data: await payments.get(params.id) }),
  });

  api.route('Payments', {
    method: 'post', path: '/payments', summary: 'Prepare the payment of an approved voucher',
    description:
      'Amount = voucher total (no partial payments). One live payment per voucher. ' +
      'Created PENDING_APPROVAL, or APPROVED when `payment.requiresApproval` is false.',
    access: { permission: 'payment:create' }, idempotent: true,
    body: z.object({
      voucherId: z.uuid(), method: z.enum(PAYMENT_METHODS), referenceNo: z.string().trim().min(1).max(100).nullable().optional(),
      paymentDate: isoDateTime.optional(),
    }).strict().refine((b) => b.method === 'CASH' || !!b.referenceNo, { path: ['referenceNo'], message: 'a reference number is required for non-cash payments' }),
    response: { status: 201, description: 'Created', schema: single(paymentSchema) },
    handler: async ({ body, user, meta }) =>
      ({ data: await payments.create(user, { ...body, paymentDate: body.paymentDate ? new Date(body.paymentDate) : undefined }, meta) }),
  });

  const commands = [
    { cmd: 'approve', permission: 'payment:approve', summary: 'Approve a payment', reason: false },
    { cmd: 'reject', permission: 'payment:approve', summary: 'Reject a payment (reason required)', reason: true },
    { cmd: 'disburse', permission: 'payment:disburse', summary: 'Pay out: cash ledger OUT, voucher → PAID, lot created (ON_PAYMENT)', reason: false },
    { cmd: 'reverse', permission: 'payment:reverse', summary: 'Reverse a paid payment: mirror cash entry, voucher → APPROVED (reason required)', reason: true },
  ] as const;

  for (const c of commands) {
    api.route('Payments', {
      method: 'post', path: `/payments/:id/${c.cmd}`, summary: c.summary,
      access: { permission: c.permission }, params: uuidParam, idempotent: true,
      body: z.object({ reason: c.reason ? reasonSchema : reasonSchema.optional() }).strict(),
      response: { status: 200, description: 'New state', schema: single(paymentSchema) },
      handler: async ({ params, body, user, meta }) => ({ data: await payments.command(user, params.id, c.cmd, body, meta) }),
    });
  }
}
