import { z } from 'zod';
import type { Api } from '../../http/api.js';
import { list, pagination, reasonSchema, single, uuidParam } from '../../http/schemas.js';
import { IDENTIFICATION_TYPES, SUPPLIER_STATUSES, type SuppliersService } from './suppliers.service.js';

const supplierSchema = z
  .object({
    id: z.uuid(), supplierCode: z.string(), fullName: z.string(), phone: z.string().nullable(), village: z.string().nullable(),
    address: z.string().nullable(), identificationType: z.enum(IDENTIFICATION_TYPES).nullable(), identificationNo: z.string().nullable(),
    status: z.enum(SUPPLIER_STATUSES), statusReason: z.string().nullable(), qrToken: z.string(), registeredById: z.uuid(),
    createdAt: z.date(), updatedAt: z.date(),
  })
  .meta({ id: 'Supplier' });

const supplierDocumentSchema = z
  .object({
    id: z.uuid(), supplierId: z.uuid(), documentId: z.uuid(), docType: z.string(), notes: z.string().nullable(), createdAt: z.date(),
    originalName: z.string().optional(), mimeType: z.string().optional(), sizeBytes: z.number().int().optional(),
  })
  .meta({ id: 'SupplierDocument' });

const historySchema = z
  .object({
    totals: z.object({ vouchers: z.number().int(), purchasedKg: z.string(), paidAmount: z.string() }),
    inspections: z.array(z.record(z.string(), z.unknown())),
    vouchers: z.array(z.record(z.string(), z.unknown())),
    payments: z.array(z.record(z.string(), z.unknown())),
  })
  .meta({ id: 'SupplierHistory' });

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const supplierFields = {
  fullName: z.string().trim().min(2).max(150),
  phone: z.string().trim().min(5).max(30).nullable().optional(),
  village: optionalText(100),
  address: optionalText(300),
  identificationType: z.enum(IDENTIFICATION_TYPES).nullable().optional(),
  identificationNo: optionalText(60),
};

export function registerSupplierRoutes(api: Api, suppliers: SuppliersService): void {
  api.route('Suppliers', {
    method: 'get', path: '/suppliers', summary: 'List suppliers',
    access: { permission: 'supplier:read' },
    query: pagination(['supplierCode', 'fullName', 'createdAt'] as const, 'fullName').extend({
      status: z.enum(SUPPLIER_STATUSES).optional(),
      search: z.string().trim().min(1).max(100).optional(),
    }).strict(),
    response: { status: 200, description: 'Page of suppliers', schema: list(supplierSchema) },
    handler: async ({ query }) => {
      const r = await suppliers.list(query);
      return { data: r.data, meta: { page: query.page, pageSize: query.pageSize, total: r.total } };
    },
  });

  api.route('Suppliers', {
    method: 'get', path: '/suppliers/:id', summary: 'Get a supplier',
    access: { permission: 'supplier:read' }, params: uuidParam,
    response: { status: 200, description: 'Supplier', schema: single(supplierSchema) },
    handler: async ({ params }) => ({ data: await suppliers.get(params.id) }),
  });

  api.route('Suppliers', {
    method: 'post', path: '/suppliers', summary: 'Register a supplier',
    description: 'Supplier code is unique; identification type + number is unique when given.',
    access: { permission: 'supplier:create' },
    body: z.object({ supplierCode: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9._/-]+$/, 'letters, digits . _ / -'), ...supplierFields }).strict(),
    response: { status: 201, description: 'Registered', schema: single(supplierSchema) },
    handler: async ({ body, user, meta }) => ({ data: await suppliers.create(user, body, meta) }),
  });

  api.route('Suppliers', {
    method: 'patch', path: '/suppliers/:id', summary: 'Update supplier details',
    access: { permission: 'supplier:update' }, params: uuidParam,
    body: z.object({ ...supplierFields, fullName: supplierFields.fullName.optional() }).strict()
      .refine((b) => Object.keys(b).length > 0, 'nothing to update'),
    response: { status: 200, description: 'Updated', schema: single(supplierSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await suppliers.update(user, params.id, body, meta) }),
  });

  api.route('Suppliers', {
    method: 'patch', path: '/suppliers/:id/status', summary: 'Activate, suspend or deactivate a supplier',
    description: 'Only ACTIVE suppliers can be inspected and bought from. Reason required (audited).',
    access: { permission: 'supplier:status' }, params: uuidParam,
    body: z.object({ status: z.enum(SUPPLIER_STATUSES), reason: reasonSchema }).strict(),
    response: { status: 200, description: 'Updated', schema: single(supplierSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await suppliers.setStatus(user, params.id, body.status, body.reason, meta) }),
  });

  api.route('Suppliers', {
    method: 'get', path: '/suppliers/:id/documents', summary: 'Documents of a supplier',
    access: { permission: 'supplier:read' }, params: uuidParam,
    response: { status: 200, description: 'Documents', schema: single(z.array(supplierDocumentSchema)) },
    handler: async ({ params }) => ({ data: await suppliers.listDocuments(params.id) }),
  });

  api.route('Suppliers', {
    method: 'post', path: '/suppliers/:id/documents', summary: 'Attach an uploaded document (ID card, …)',
    description: 'Upload the file with POST /files first, then link it here.',
    access: { permission: 'supplier:update' }, params: uuidParam,
    body: z.object({ documentId: z.uuid(), docType: z.string().trim().min(2).max(60), notes: z.string().trim().max(500).nullable().optional() }).strict(),
    response: { status: 201, description: 'Linked', schema: single(supplierDocumentSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await suppliers.addDocument(user, params.id, body, meta) }),
  });

  api.route('Suppliers', {
    method: 'get', path: '/suppliers/:id/history', summary: 'Purchases, payments and inspections of a supplier',
    access: { permission: 'supplier:read' }, params: uuidParam,
    response: { status: 200, description: 'History', schema: single(historySchema) },
    handler: async ({ params }) => ({ data: await suppliers.history(params.id) }),
  });
}
