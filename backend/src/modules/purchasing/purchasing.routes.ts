import { z } from 'zod';
import type { SettingsService } from '../../core/settings/settings.service.js';
import type { Api } from '../../http/api.js';
import { businessDateString, isoDateTime, kgString, list, moneyString, pagination, reasonSchema, single, uuidParam, versionSchema } from '../../http/schemas.js';
import { VOUCHER_STATUSES } from './domain/voucher-state-machine.js';
import type { PurchasingService, VoucherCommandName } from './purchasing.service.js';
import { renderVoucherPdf, type VoucherPdfData } from './voucher-pdf.js';

const weighingSchema = z.object({
  id: z.uuid(), scaleId: z.uuid(), scaleCode: z.string(), grossKg: z.string(), tareKg: z.string(), netKg: z.string(),
  weighedById: z.uuid(), weighedAt: z.date(), scaleVerified: z.boolean(),
});

const itemSchema = z.object({
  id: z.uuid(), lineNo: z.number().int(), coffeeTypeId: z.uuid(), coffeeTypeName: z.string(), qualityGradeId: z.uuid().nullable(),
  gradeCode: z.string().nullable(), weightKg: z.string(), pricePerKg: z.string(), amount: z.string(), weighings: z.array(weighingSchema),
});

const voucherSummarySchema = z
  .object({
    id: z.uuid(), voucherNo: z.string(), voucherDate: z.string(), supplierId: z.uuid(), supplierCode: z.string(), supplierName: z.string(),
    totalWeightKg: z.string(), pricePerKg: z.string(), totalAmount: z.string(), status: z.enum(VOUCHER_STATUSES),
    scaleWarning: z.string().nullable(), lotNumber: z.string().nullable(), version: z.number().int(), createdAt: z.date(),
  })
  .meta({ id: 'PurchaseVoucherSummary' });

const voucherSchema = z
  .object({
    id: z.uuid(), voucherNo: z.string(), voucherDate: z.string(), status: z.enum(VOUCHER_STATUSES), version: z.number().int(),
    supplierId: z.uuid(), supplierCode: z.string(), supplierNameSnap: z.string(), supplierPhoneSnap: z.string().nullable(),
    coffeeTypeId: z.uuid(), coffeeTypeName: z.string(), qualityInspectionId: z.uuid(), inspectionNo: z.string(),
    qualityGradeId: z.uuid().nullable(), gradeCode: z.string().nullable(),
    totalWeightKg: z.string(), pricePerKg: z.string(), totalAmount: z.string(), scaleWarning: z.string().nullable(),
    createdById: z.uuid(), createdByName: z.string(), weighingClerkId: z.uuid(), weighingClerkName: z.string(),
    qualityInspectorId: z.uuid(), qualityInspectorName: z.string(), submittedAt: z.date().nullable(),
    verifiedById: z.uuid().nullable(), verifiedByName: z.string().nullable(), verifiedAt: z.date().nullable(),
    approvedById: z.uuid().nullable(), approvedByName: z.string().nullable(), approvedAt: z.date().nullable(),
    cashierId: z.uuid().nullable(), cashierName: z.string().nullable(),
    cancelledById: z.uuid().nullable(), cancelledAt: z.date().nullable(), cancelReason: z.string().nullable(),
    items: z.array(itemSchema),
    lot: z.object({ id: z.uuid(), lotNumber: z.string(), currentStage: z.string(), status: z.string() }).nullable(),
    payments: z.array(z.object({ id: z.uuid(), paymentNo: z.string(), amount: z.string(), status: z.string(), method: z.string(), paidAt: z.date().nullable() })),
    createdAt: z.date(), updatedAt: z.date(),
  })
  .meta({ id: 'PurchaseVoucher' });

const voucherBody = z.object({
  qualityInspectionId: z.uuid(),
  coffeeTypeId: z.uuid(),
  qualityGradeId: z.uuid().nullable().optional(),
  pricePerKg: moneyString,
  voucherDate: businessDateString.optional().meta({ description: 'Defaults to today (station timezone); limited by ops.maxBackdateHours' }),
  weighingClerkId: z.uuid().optional().meta({ description: 'User who weighed; defaults to the caller' }),
  items: z.array(z.object({
    coffeeTypeId: z.uuid().optional(),
    qualityGradeId: z.uuid().nullable().optional(),
    pricePerKg: moneyString.optional().meta({ description: 'Defaults to the voucher price' }),
    weighings: z.array(z.object({
      scaleId: z.uuid(), grossKg: kgString, tareKg: kgString.optional(), weighedAt: isoDateTime.optional(),
    }).strict()).min(1).max(100),
  }).strict()).min(1).max(20),
}).strict();

const COMMANDS: { cmd: VoucherCommandName; permission: string; summary: string; reason: 'required' | 'optional' }[] = [
  { cmd: 'submit', permission: 'purchase:submit', summary: 'Submit a draft for verification', reason: 'optional' },
  { cmd: 'verify', permission: 'purchase:verify', summary: 'Verify grade and weights (verifier ∉ {creator, weighing clerk})', reason: 'optional' },
  { cmd: 'return', permission: 'purchase:return', summary: 'Return a pending/verified voucher to draft for correction', reason: 'required' },
  { cmd: 'approve', permission: 'purchase:approve', summary: 'Approve (approver ∉ {creator, weighing clerk, verifier})', reason: 'optional' },
  { cmd: 'cancel', permission: 'purchase:cancel', summary: 'Cancel a draft, pending or verified voucher', reason: 'required' },
  { cmd: 'void', permission: 'purchase:void', summary: 'Void an approved voucher (no live payment; lot still PURCHASED)', reason: 'required' },
];

export function registerPurchasingRoutes(api: Api, purchasing: PurchasingService, settings: SettingsService): void {
  api.route('Purchasing', {
    method: 'get', path: '/purchases', summary: 'List purchase vouchers',
    access: { permission: 'purchase:read' },
    query: pagination(['voucherDate', 'voucherNo', 'totalAmount', 'createdAt'] as const, '-createdAt').extend({
      status: z.enum(VOUCHER_STATUSES).optional(), supplierId: z.uuid().optional(),
      from: businessDateString.optional(), to: businessDateString.optional(), search: z.string().trim().min(1).max(100).optional(),
    }).strict(),
    response: { status: 200, description: 'Page of vouchers', schema: list(voucherSummarySchema) },
    handler: async ({ query }) => {
      const r = await purchasing.list(query);
      return { data: r.data, meta: { page: query.page, pageSize: query.pageSize, total: r.total } };
    },
  });

  // Registered before /purchases/:id so "summary" is not taken for an id.
  api.route('Purchasing', {
    method: 'get', path: '/purchases/summary', summary: 'Today\'s purchases and vouchers waiting per status (dashboard)',
    access: { permission: 'purchase:read' },
    response: {
      status: 200, description: 'Summary',
      schema: single(z.object({
        date: z.string(), todayVouchers: z.number().int(), todayKg: z.string(), todayAmount: z.string(), draft: z.number().int(),
        pendingVerification: z.number().int(), verified: z.number().int(), approved: z.number().int(),
      })),
    },
    handler: async () => ({ data: await purchasing.summary() }),
  });

  api.route('Purchasing', {
    method: 'get', path: '/purchases/:id', summary: 'Get a voucher with items, weighings, lot and payments',
    access: { permission: 'purchase:read' }, params: uuidParam,
    response: { status: 200, description: 'Voucher', schema: single(voucherSchema) },
    handler: async ({ params }) => ({ data: await purchasing.get(params.id) }),
  });

  api.route('Purchasing', {
    method: 'post', path: '/purchases', summary: 'Create a draft voucher with its weighings',
    description:
      'The inspection must be ACCEPTED and unused. Each weighing must be on a scale verified within `scale.verificationFrequencyHours`; ' +
      'otherwise `scale.unverifiedPolicy` BLOCK → 422 SCALE_NOT_VERIFIED, WARN → saved with `scaleWarning`. Totals are computed by the server.',
    access: { permission: 'purchase:create' }, idempotent: true, body: voucherBody,
    response: { status: 201, description: 'Draft created', schema: single(voucherSchema) },
    handler: async ({ body, user, meta }) => ({ data: await purchasing.create(user, body, meta) }),
  });

  api.route('Purchasing', {
    method: 'put', path: '/purchases/:id', summary: 'Replace a draft voucher (header, items and weighings)',
    access: { permission: 'purchase:update' }, params: uuidParam,
    body: voucherBody.extend({ version: versionSchema }).strict(),
    response: { status: 200, description: 'Updated', schema: single(voucherSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await purchasing.update(user, params.id, body, meta) }),
  });

  for (const c of COMMANDS) {
    api.route('Purchasing', {
      method: 'post', path: `/purchases/:id/${c.cmd}`, summary: c.summary,
      access: { permission: c.permission }, params: uuidParam,
      body: z.object({ version: versionSchema, reason: c.reason === 'required' ? reasonSchema : reasonSchema.optional() }).strict(),
      response: { status: 200, description: 'New state', schema: single(voucherSchema) },
      handler: async ({ params, body, user, meta }) => ({ data: await purchasing.command(user, params.id, c.cmd, body, meta) }),
    });
  }

  api.route('Purchasing', {
    method: 'get', path: '/purchases/:id/pdf', summary: 'Printable voucher (PDF)',
    access: { permission: 'purchase:read' }, params: uuidParam,
    response: { status: 200, description: 'PDF document', contentType: 'application/pdf' },
    handler: async ({ params, res }) => {
      const v = await purchasing.get(params.id);
      const [currency, timeZone] = await Promise.all([settings.get<string>('finance.currency'), settings.get<string>('station.timezone')]);
      const pdf = await renderVoucherPdf(
        { ...(v as unknown as VoucherPdfData), supplierName: v.supplierNameSnap },
        { currency, timeZone },
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${v.voucherNo}.pdf"`);
      res.send(pdf);
    },
  });
}
