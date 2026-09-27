import { z } from 'zod';
import type { Api } from '../../http/api.js';
import { boolQuery, list, pagination, pctString, reasonSchema, single, uuidParam } from '../../http/schemas.js';
import type { HoldsService } from './holds.service.js';
import type { QualityService } from './quality.service.js';

const METRICS = ['RED_RIPE_PCT', 'GREEN_UNRIPE_PCT', 'OVERRIPE_DAMAGED_PCT'] as const;
const OPERATORS = ['LT', 'LTE', 'GT', 'GTE'] as const;
const ACTIONS = ['REJECT', 'WARN'] as const;
const STAGES = ['CHERRY', 'PARCHMENT'] as const;

const inspectionSchema = z
  .object({
    id: z.uuid(), inspectionNo: z.string(), supplierId: z.uuid(), supplierCode: z.string(), supplierName: z.string(),
    inspectorId: z.uuid(), inspectorName: z.string(), inspectedAt: z.date(),
    redRipePct: z.string(), greenUnripePct: z.string(), overripeDamagedPct: z.string(),
    qualityGradeId: z.uuid().nullable(), gradeCode: z.string().nullable(), decision: z.enum(['ACCEPTED', 'REJECTED']),
    rejectionReason: z.string().nullable(), ruleEvaluation: z.unknown(), notes: z.string().nullable(),
    voucherId: z.uuid().nullable().meta({ description: 'Voucher that used this inspection (an inspection is used once)' }),
    voucherNo: z.string().nullable(), createdAt: z.date(),
  })
  .meta({ id: 'QualityInspection' });

const ruleSchema = z
  .object({
    id: z.uuid(), name: z.string(), metric: z.enum(METRICS), operator: z.enum(OPERATORS), threshold: z.string(), action: z.enum(ACTIONS),
    isActive: z.boolean(), description: z.string().nullable(), createdAt: z.date(), updatedAt: z.date(),
  })
  .meta({ id: 'QualityRule' });

const gradeSchema = z
  .object({ id: z.uuid(), code: z.string(), name: z.string(), stage: z.enum(STAGES), sortOrder: z.number().int(), isActive: z.boolean() })
  .meta({ id: 'CoffeeGrade' });

const coffeeTypeSchema = z.object({ id: z.uuid(), code: z.string(), name: z.string(), isActive: z.boolean() }).meta({ id: 'CoffeeType' });

const holdSchema = z
  .object({
    id: z.uuid(), lotId: z.uuid(), lotNumber: z.string(), stage: z.string(), reason: z.string(), status: z.enum(['ACTIVE', 'RELEASED']),
    placedById: z.uuid(), placedByName: z.string(), placedAt: z.date(), releasedById: z.uuid().nullable(),
    releasedByName: z.string().nullable(), releasedAt: z.date().nullable(), releaseNotes: z.string().nullable(),
  })
  .meta({ id: 'QualityHold' });

/** Reading reference data is needed by inspectors, clerks and managers alike. */
const REFERENCE_READ = ['quality:rules-read', 'quality:read', 'purchase:read'];
const code = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/);

export function registerQualityRoutes(api: Api, quality: QualityService, holds: HoldsService): void {
  // ---------------- Inspections ----------------
  api.route('Quality', {
    method: 'get', path: '/quality/inspections', summary: 'List cherry quality inspections',
    access: { permission: 'quality:read' },
    query: pagination(['inspectedAt'] as const, '-inspectedAt').extend({
      supplierId: z.uuid().optional(),
      decision: z.enum(['ACCEPTED', 'REJECTED']).optional(),
      available: boolQuery.optional().meta({ description: 'true = ACCEPTED and not yet used by a voucher' }),
    }).strict(),
    response: { status: 200, description: 'Page of inspections', schema: list(inspectionSchema) },
    handler: async ({ query }) => {
      const r = await quality.listInspections(query);
      return { data: r.data, meta: { page: query.page, pageSize: query.pageSize, total: r.total } };
    },
  });

  api.route('Quality', {
    method: 'get', path: '/quality/inspections/:id', summary: 'Get an inspection (with its rule evaluation)',
    access: { permission: 'quality:read' }, params: uuidParam,
    response: { status: 200, description: 'Inspection', schema: single(inspectionSchema) },
    handler: async ({ params }) => ({ data: await quality.getInspection(params.id) }),
  });

  api.route('Quality', {
    method: 'post', path: '/quality/inspections', summary: 'Record a cherry quality inspection',
    description: 'Supplier must be ACTIVE; percentages must sum to 100 within `quality.percentSumTolerance`; active REJECT rules force REJECTED.',
    access: { permission: 'quality:inspect' },
    body: z.object({
      supplierId: z.uuid(), redRipePct: pctString, greenUnripePct: pctString, overripeDamagedPct: pctString,
      qualityGradeId: z.uuid().nullable().optional(), decision: z.enum(['ACCEPTED', 'REJECTED']),
      rejectionReason: z.string().trim().max(500).nullable().optional(), notes: z.string().trim().max(1000).nullable().optional(),
    }).strict(),
    response: { status: 201, description: 'Recorded', schema: single(inspectionSchema) },
    handler: async ({ body, user, meta }) => ({ data: await quality.inspect(user, body, meta) }),
  });

  // ---------------- Rules ----------------
  const ruleBody = z.object({
    name: z.string().trim().min(3).max(100), metric: z.enum(METRICS), operator: z.enum(OPERATORS), threshold: pctString,
    action: z.enum(ACTIONS), description: z.string().trim().max(500).nullable().optional(), isActive: z.boolean().optional(),
  }).strict();

  api.route('Quality', {
    method: 'get', path: '/quality/rules', summary: 'List quality rules',
    access: { permission: 'quality:rules-read' },
    response: { status: 200, description: 'Rules', schema: single(z.array(ruleSchema)) },
    handler: async () => ({ data: await quality.listRules() }),
  });

  api.route('Quality', {
    method: 'post', path: '/quality/rules', summary: 'Create a quality rule',
    description: 'E.g. GREEN_UNRIPE_PCT GT 10 → REJECT. With no rules the inspector decides alone.',
    access: { permission: 'quality:rules-manage' }, body: ruleBody,
    response: { status: 201, description: 'Created', schema: single(ruleSchema) },
    handler: async ({ body, user, meta }) => ({ data: await quality.createRule(user, body, meta) }),
  });

  api.route('Quality', {
    method: 'patch', path: '/quality/rules/:id', summary: 'Update or deactivate a quality rule',
    access: { permission: 'quality:rules-manage' }, params: uuidParam,
    body: ruleBody.partial().strict().refine((b) => Object.keys(b).length > 0, 'nothing to update'),
    response: { status: 200, description: 'Updated', schema: single(ruleSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await quality.updateRule(user, params.id, body, meta) }),
  });

  // ---------------- Grades & coffee types ----------------
  api.route('Reference data', {
    method: 'get', path: '/quality/grades', summary: 'List coffee grades',
    access: { permission: REFERENCE_READ },
    query: z.object({ stage: z.enum(STAGES).optional(), active: boolQuery.optional() }).strict(),
    response: { status: 200, description: 'Grades', schema: single(z.array(gradeSchema)) },
    handler: async ({ query }) => ({ data: await quality.listGrades(query) }),
  });

  api.route('Reference data', {
    method: 'post', path: '/quality/grades', summary: 'Create a coffee grade',
    access: { permission: 'quality:rules-manage' },
    body: z.object({ code, name: z.string().trim().min(2).max(60), stage: z.enum(STAGES), sortOrder: z.number().int().min(0).max(1000).optional() }).strict(),
    response: { status: 201, description: 'Created', schema: single(gradeSchema) },
    handler: async ({ body, user, meta }) => ({ data: await quality.createGrade(user, body, meta) }),
  });

  api.route('Reference data', {
    method: 'patch', path: '/quality/grades/:id', summary: 'Update or deactivate a coffee grade',
    access: { permission: 'quality:rules-manage' }, params: uuidParam,
    body: z.object({ name: z.string().trim().min(2).max(60).optional(), sortOrder: z.number().int().min(0).max(1000).optional(), isActive: z.boolean().optional() })
      .strict().refine((b) => Object.keys(b).length > 0, 'nothing to update'),
    response: { status: 200, description: 'Updated', schema: single(gradeSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await quality.updateGrade(user, params.id, body, meta) }),
  });

  api.route('Reference data', {
    method: 'get', path: '/coffee-types', summary: 'List coffee types',
    access: { permission: REFERENCE_READ },
    query: z.object({ active: boolQuery.optional() }).strict(),
    response: { status: 200, description: 'Coffee types', schema: single(z.array(coffeeTypeSchema)) },
    handler: async ({ query }) => ({ data: await quality.listCoffeeTypes(query.active) }),
  });

  api.route('Reference data', {
    method: 'post', path: '/coffee-types', summary: 'Create a coffee type',
    access: { permission: 'quality:rules-manage' },
    body: z.object({ code, name: z.string().trim().min(2).max(80) }).strict(),
    response: { status: 201, description: 'Created', schema: single(coffeeTypeSchema) },
    handler: async ({ body, user, meta }) => ({ data: await quality.createCoffeeType(user, body, meta) }),
  });

  api.route('Reference data', {
    method: 'patch', path: '/coffee-types/:id', summary: 'Update or deactivate a coffee type',
    access: { permission: 'quality:rules-manage' }, params: uuidParam,
    body: z.object({ name: z.string().trim().min(2).max(80).optional(), isActive: z.boolean().optional() })
      .strict().refine((b) => Object.keys(b).length > 0, 'nothing to update'),
    response: { status: 200, description: 'Updated', schema: single(coffeeTypeSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await quality.updateCoffeeType(user, params.id, body, meta) }),
  });

  // ---------------- Holds ----------------
  api.route('Quality', {
    method: 'get', path: '/quality/holds', summary: 'List quality holds',
    access: { permission: 'quality:hold-read' },
    query: pagination(['placedAt'] as const, '-placedAt').extend({
      status: z.enum(['ACTIVE', 'RELEASED']).optional(), lotId: z.uuid().optional(),
    }).strict(),
    response: { status: 200, description: 'Page of holds', schema: list(holdSchema) },
    handler: async ({ query }) => {
      const r = await holds.list(query);
      return { data: r.data, meta: { page: query.page, pageSize: query.pageSize, total: r.total } };
    },
  });

  api.route('Quality', {
    method: 'post', path: '/quality/holds', summary: 'Place a quality hold on a lot',
    description: 'Blocks every forward step of the lot and its child lots until released.',
    access: { permission: 'quality:hold' },
    body: z.object({ lotNumber: z.string().trim().min(3).max(60), reason: reasonSchema }).strict(),
    response: { status: 201, description: 'Hold placed', schema: single(holdSchema) },
    handler: async ({ body, user, meta }) => ({ data: await holds.place(user, body, meta) }),
  });

  api.route('Quality', {
    method: 'post', path: '/quality/holds/:id/release', summary: 'Release a quality hold',
    access: { permission: 'quality:hold-release' }, params: uuidParam,
    body: z.object({ notes: reasonSchema }).strict(),
    response: { status: 200, description: 'Released', schema: single(holdSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await holds.release(user, params.id, body.notes, meta) }),
  });
}
