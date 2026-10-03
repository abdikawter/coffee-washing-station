import { z } from 'zod';
import type { Api } from '../../http/api.js';
import { boolQuery, businessDateString, kgString, list, pagination, reasonSchema, single, uuidParam } from '../../http/schemas.js';
import { MUCILAGE, type FermentationService } from './fermentation.service.js';
import type { HopperService } from './hopper.service.js';
import type { ProcessingEquipmentService, ProcessingUnit } from './processing-equipment.service.js';
import type { PulpingService } from './pulping.service.js';
import type { WashingGradingService } from './washing-grading.service.js';

export interface ProcessingServices {
  units: ProcessingEquipmentService;
  hopper: HopperService;
  pulping: PulpingService;
  fermentation: FermentationService;
  washing: WashingGradingService;
}

/** Response objects of the wet-processing records (documented loosely; key fields listed). */
const record = (id: string, fields: Record<string, z.ZodType>) => z.looseObject({ id: z.uuid(), ...fields }).meta({ id });
const unitSchema = record('ProcessingUnit', {
  equipmentId: z.uuid(), code: z.string(), name: z.string(), status: z.string(), location: z.string().nullable(), capacityKg: z.string().optional(),
});
const intakeSchema = record('HopperIntake', {
  lotId: z.uuid(), lotNumber: z.string(), hopperCode: z.string(), intakeAt: z.date(), purchasedCherryKg: z.string(), intakeKg: z.string(),
  floatersKg: z.string().nullable(), sinkersKg: z.string().nullable(), flotationAt: z.date().nullable(), operatorName: z.string(),
});
const reconSchema = record('HopperReconciliation', {
  reconDate: z.string(), purchasedCherryKg: z.string(), hopperIntakeKg: z.string(), differenceKg: z.string(), differencePct: z.string(),
  tolerancePct: z.string(), status: z.enum(['BALANCED', 'DISCREPANCY', 'REVIEWED']), detail: z.unknown(), reviewedByName: z.string().nullable(),
  reviewNotes: z.string().nullable(),
});
const inspectionSchema = record('PulpingMachineInspection', {
  machineId: z.uuid(), inspectionDate: z.string(), discTeethOk: z.boolean(), discSpacingOk: z.boolean(), cleaningDone: z.boolean(),
  result: z.enum(['PASS', 'FAIL']),
});
const pulpingSchema = record('PulpingRecord', {
  lotId: z.uuid(), lotNumber: z.string(), machineCode: z.string(), startedAt: z.date(), endedAt: z.date().nullable(), inputKg: z.string(),
  outputKg: z.string().nullable(),
});
const batchSchema = record('FermentationBatch', {
  batchNumber: z.string(), lotId: z.uuid(), lotNumber: z.string(), tankCode: z.string(), inputKg: z.string(), startAt: z.date(),
  minDurationHours: z.string(), maxDurationHours: z.string(), endAt: z.date().nullable(), mucilageAssessment: z.enum(MUCILAGE),
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  timing: z.object({ elapsedHours: z.string(), minEndAt: z.date(), maxEndAt: z.date(), state: z.enum(['BEFORE_MIN', 'IN_WINDOW', 'APPROACHING_MAX', 'OVERDUE']) }),
});
const washingSchema = record('WashingRecord', { lotId: z.uuid(), lotNumber: z.string(), washedAt: z.date(), inputKg: z.string(), outputKg: z.string() });
const gradingSchema = record('GradingRecord', {
  lotId: z.uuid(), lotNumber: z.string(), totalOutputKg: z.string(),
  children: z.array(z.object({ id: z.uuid(), lotNumber: z.string(), grade: z.string(), weightKg: z.string() })).optional(),
});
const caResult = z.object({ mode: z.enum(['AUTO_CREATE', 'RECOMMEND']), correctiveAction: z.object({ id: z.uuid(), caNumber: z.string() }).nullable() }).nullable();

const notes = z.string().trim().max(1000).nullable().optional();
const page = <S extends readonly [string, ...string[]]>(sortable: S, def: `${'' | '-'}${S[number]}`) => pagination(sortable, def);

export function registerProcessingRoutes(api: Api, s: ProcessingServices): void {
  // ---------------- Equipment registry (hoppers, pulpers, tanks) ----------------
  const units: { unit: ProcessingUnit; path: string; tag: string; read: string; label: string }[] = [
    { unit: 'hopper', path: '/hoppers', tag: 'Hopper', read: 'hopper:read', label: 'hopper' },
    { unit: 'pulper', path: '/pulping/machines', tag: 'Pulping', read: 'pulping:read', label: 'pulping machine' },
    { unit: 'tank', path: '/fermentation/tanks', tag: 'Fermentation', read: 'fermentation:read', label: 'fermentation tank' },
  ];
  for (const u of units) {
    api.route(u.tag, {
      method: 'get', path: u.path, summary: `List ${u.label}s`,
      access: { permission: u.read },
      response: { status: 200, description: `${u.label}s`, schema: single(z.array(unitSchema)) },
      handler: async () => ({ data: await s.units.list(u.unit) }),
    });
    api.route(u.tag, {
      method: 'post', path: u.path, summary: `Register a ${u.label}`,
      access: { permission: 'equipment:manage' },
      body: z.object({
        code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9._/-]+$/), name: z.string().trim().min(2).max(100),
        location: z.string().trim().max(100).nullable().optional(), ...(u.unit === 'pulper' ? {} : { capacityKg: kgString }),
      }).strict(),
      response: { status: 201, description: 'Registered', schema: single(unitSchema) },
      handler: async ({ body, user, meta }) => ({ data: await s.units.create(user, u.unit, body as { code: string; name: string; location?: string | null; capacityKg?: string }, meta) }),
    });
  }

  // ---------------- Hopper & flotation ----------------
  api.route('Hopper', {
    method: 'get', path: '/hopper/intakes', summary: 'Hopper intakes (with flotation results)',
    access: { permission: 'hopper:read' },
    query: page(['intakeAt'] as const, '-intakeAt').extend({ lotId: z.uuid().optional(), pendingFlotation: boolQuery.optional() }).strict(),
    response: { status: 200, description: 'Page of intakes', schema: list(intakeSchema) },
    handler: async ({ query }) => {
      const r = await s.hopper.listIntakes(query);
      return { data: r.data, meta: { page: query.page, pageSize: query.pageSize, total: r.total } };
    },
  });

  api.route('Hopper', {
    method: 'post', path: '/hopper/intakes', summary: 'Receive a PURCHASED lot into a hopper',
    description: 'Lot must be PURCHASED, ACTIVE and not on hold; hopper OPERATIONAL. Above capacity → warning. Event HOPPER_RECEIVED.',
    access: { permission: 'hopper:record' }, idempotent: true,
    body: z.object({ lotId: z.uuid(), hopperId: z.uuid(), intakeKg: kgString, notes }).strict(),
    response: { status: 201, description: 'Received', schema: single(intakeSchema.extend({ warnings: z.array(z.string()) })) },
    handler: async ({ body, user, meta }) => ({ data: await s.hopper.intake(user, body, meta) }),
  });

  api.route('Hopper', {
    method: 'post', path: '/hopper/intakes/:id/flotation', summary: 'Record flotation (floaters / sinkers)',
    description: 'Floaters + sinkers vs intake within `hopper.flotationBalanceTolerancePct` (0 = strict); an imbalance raises or recommends a corrective action. Event FLOTATION_COMPLETED.',
    access: { permission: 'hopper:record' }, params: uuidParam,
    body: z.object({ floatersKg: kgString, sinkersKg: kgString, notes }).strict(),
    response: {
      status: 200, description: 'Recorded',
      schema: single(intakeSchema.extend({
        balance: z.object({ totalKg: z.string(), differenceKg: z.string(), differencePct: z.string(), tolerancePct: z.number(), withinTolerance: z.boolean() }),
        correctiveAction: caResult,
      })),
    },
    handler: async ({ params, body, user, meta }) => ({ data: await s.hopper.flotation(user, params.id, body, meta) }),
  });

  api.route('Hopper', {
    method: 'get', path: '/hopper/reconciliations', summary: 'Daily purchased-vs-intake reconciliations',
    access: { permission: 'reconciliation:read' },
    query: page(['reconDate'] as const, '-reconDate').extend({
      status: z.enum(['BALANCED', 'DISCREPANCY', 'REVIEWED']).optional(), from: businessDateString.optional(), to: businessDateString.optional(),
    }).strict(),
    response: { status: 200, description: 'Page of reconciliations', schema: list(reconSchema) },
    handler: async ({ query }) => {
      const r = await s.hopper.listReconciliations(query);
      return { data: r.data, meta: { page: query.page, pageSize: query.pageSize, total: r.total } };
    },
  });

  api.route('Hopper', {
    method: 'post', path: '/hopper/reconciliations/run', summary: 'Run (or re-run) the reconciliation of a day',
    description: 'Defaults to today (station timezone). diff% > `hopper.reconciliationTolerancePct` → DISCREPANCY + corrective action per `controls.correctiveActionMode`. A REVIEWED day cannot be re-run.',
    access: { permission: 'reconciliation:run' },
    body: z.object({ date: businessDateString.optional() }).strict(),
    response: { status: 200, description: 'Reconciliation', schema: single(reconSchema.extend({ correctiveAction: caResult })) },
    handler: async ({ body, user, meta }) => ({ data: await s.hopper.run(user, body.date, meta) }),
  });

  api.route('Hopper', {
    method: 'post', path: '/hopper/reconciliations/:id/review', summary: 'Review a discrepancy (Site Manager)',
    access: { permission: 'reconciliation:review' }, params: uuidParam,
    body: z.object({ notes: reasonSchema }).strict(),
    response: { status: 200, description: 'Reviewed', schema: single(reconSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await s.hopper.review(user, params.id, body.notes, meta) }),
  });

  // ---------------- Pulping ----------------
  api.route('Pulping', {
    method: 'get', path: '/pulping/machines/:id/inspections', summary: 'Daily inspections of a pulping machine',
    access: { permission: 'pulping:read' }, params: uuidParam,
    response: { status: 200, description: 'Inspections', schema: single(z.array(inspectionSchema)) },
    handler: async ({ params }) => ({ data: await s.pulping.listInspections(params.id) }),
  });

  api.route('Pulping', {
    method: 'post', path: '/pulping/machines/:id/inspections', summary: 'Record today\'s machine inspection (disc teeth, spacing, cleaning)',
    access: { permission: 'pulping:record' }, params: uuidParam,
    body: z.object({
      discTeethOk: z.boolean(), discSpacingOk: z.boolean(), discSpacingMm: z.string().regex(/^\d{1,4}(\.\d{1,2})?$/).nullable().optional(),
      cleaningDone: z.boolean(), notes,
    }).strict(),
    response: { status: 201, description: 'Recorded (PASS only when every check is OK)', schema: single(inspectionSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await s.pulping.inspect(user, params.id, body, meta) }),
  });

  api.route('Pulping', {
    method: 'get', path: '/pulping/records', summary: 'Pulping runs',
    access: { permission: 'pulping:read' },
    query: page(['startedAt'] as const, '-startedAt').extend({ lotId: z.uuid().optional(), open: boolQuery.optional() }).strict(),
    response: { status: 200, description: 'Page of pulping runs', schema: list(pulpingSchema) },
    handler: async ({ query }) => {
      const r = await s.pulping.listRecords(query);
      return { data: r.data, meta: { page: query.page, pageSize: query.pageSize, total: r.total } };
    },
  });

  api.route('Pulping', {
    method: 'post', path: '/pulping/records', summary: 'Pulp a FLOTATION lot',
    description: 'Machine OPERATIONAL with today\'s passing inspection per `pulping.dailyInspectionPolicy` (BLOCK → 422 PULPING_INSPECTION_REQUIRED; WARN → allowed + corrective action). Event PULPED.',
    access: { permission: 'pulping:record' }, idempotent: true,
    body: z.object({ lotId: z.uuid(), machineId: z.uuid(), inputKg: kgString.optional(), outputKg: kgString.nullable().optional(), notes }).strict(),
    response: { status: 201, description: 'Recorded', schema: single(pulpingSchema.extend({ inspectionProblem: z.enum(['MISSING', 'FAILED']).nullable(), correctiveAction: caResult })) },
    handler: async ({ body, user, meta }) => ({ data: await s.pulping.record(user, body, meta) }),
  });

  api.route('Pulping', {
    method: 'post', path: '/pulping/records/:id/complete', summary: 'Record the output of an open pulping run',
    access: { permission: 'pulping:record' }, params: uuidParam,
    body: z.object({ outputKg: kgString, notes }).strict(),
    response: { status: 200, description: 'Completed', schema: single(pulpingSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await s.pulping.complete(user, params.id, body, meta) }),
  });

  // ---------------- Fermentation ----------------
  api.route('Fermentation', {
    method: 'get', path: '/fermentation/batches', summary: 'Fermentation batches (in progress first) with timing',
    access: { permission: 'fermentation:read' },
    query: page(['startAt'] as const, '-startAt').extend({ status: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(), lotId: z.uuid().optional() }).strict(),
    response: { status: 200, description: 'Page of batches', schema: list(batchSchema) },
    handler: async ({ query }) => {
      const r = await s.fermentation.list(query);
      return { data: r.data, meta: { page: query.page, pageSize: query.pageSize, total: r.total } };
    },
  });

  api.route('Fermentation', {
    method: 'get', path: '/fermentation/batches/:id', summary: 'Fermentation batch with its measurements',
    access: { permission: 'fermentation:read' }, params: uuidParam,
    response: { status: 200, description: 'Batch', schema: single(batchSchema.extend({ measurements: z.array(z.record(z.string(), z.unknown())) })) },
    handler: async ({ params }) => ({ data: await s.fermentation.get(params.id) }),
  });

  api.route('Fermentation', {
    method: 'post', path: '/fermentation/batches', summary: 'Start fermentation of a pulped lot in a free tank',
    description: 'Tank OPERATIONAL and free (one active batch per tank), within capacity. Duration window snapshotted from `fermentation.minHours` / `maxHours`. Event FERMENTATION_STARTED.',
    access: { permission: 'fermentation:record' }, idempotent: true,
    body: z.object({
      lotId: z.uuid(), tankId: z.uuid(), inputKg: kgString.optional(), expectedDurationHours: z.number().positive().max(336).optional(), notes,
    }).strict(),
    response: { status: 201, description: 'Started', schema: single(batchSchema) },
    handler: async ({ body, user, meta }) => ({ data: await s.fermentation.start(user, body, meta) }),
  });

  const measure = z.string().regex(/^-?\d{1,4}(\.\d{1,2})?$/);
  api.route('Fermentation', {
    method: 'post', path: '/fermentation/batches/:id/measurements', summary: 'Record a measurement (temperature, pH, sweetness, acidity, mucilage)',
    access: { permission: ['fermentation:record', 'fermentation:assess'] }, params: uuidParam,
    body: z.object({
      temperatureC: measure.nullable().optional(), ph: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).refine((v) => Number(v) <= 14, 'pH is 0–14').nullable().optional(),
      sweetness: measure.nullable().optional(), acidity: measure.nullable().optional(), mucilageAssessment: z.enum(MUCILAGE).default('NOT_ASSESSED'), notes,
    }).strict(),
    response: { status: 201, description: 'Recorded; returns the batch', schema: single(batchSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await s.fermentation.measure(user, params.id, body, meta) }),
  });

  api.route('Fermentation', {
    method: 'post', path: '/fermentation/batches/:id/complete', summary: 'Complete fermentation',
    description: 'Before the minimum duration a reason is required; with `fermentation.requireMucilageCompleteToEnd` the mucilage must be assessed COMPLETE. Event FERMENTATION_COMPLETED.',
    access: { permission: 'fermentation:record' }, params: uuidParam,
    body: z.object({ reason: reasonSchema.optional(), outputKg: kgString.optional() }).strict(),
    response: { status: 200, description: 'Completed', schema: single(batchSchema.extend({ correctiveAction: caResult })) },
    handler: async ({ params, body, user, meta }) => ({ data: await s.fermentation.complete(user, params.id, body, meta) }),
  });

  // ---------------- Washing & grading ----------------
  api.route('Washing & grading', {
    method: 'get', path: '/washing/records', summary: 'Washing records',
    access: { permission: 'washing:read' },
    query: page(['washedAt'] as const, '-washedAt').extend({ lotId: z.uuid().optional() }).strict(),
    response: { status: 200, description: 'Page of washing records', schema: list(washingSchema) },
    handler: async ({ query }) => {
      const r = await s.washing.listWashing(query);
      return { data: r.data, meta: { page: query.page, pageSize: query.pageSize, total: r.total } };
    },
  });

  api.route('Washing & grading', {
    method: 'post', path: '/washing/records', summary: 'Wash a lot whose fermentation is completed',
    access: { permission: 'washing:record' }, idempotent: true,
    body: z.object({ lotId: z.uuid(), inputKg: kgString.optional(), outputKg: kgString, densitySeparation: z.string().trim().max(200).nullable().optional(), notes }).strict(),
    response: { status: 201, description: 'Recorded', schema: single(washingSchema) },
    handler: async ({ body, user, meta }) => ({ data: await s.washing.wash(user, body, meta) }),
  });

  api.route('Washing & grading', {
    method: 'get', path: '/grading/records', summary: 'Grading records with their grade outputs and child lots',
    access: { permission: 'washing:read' },
    query: page(['gradedAt'] as const, '-gradedAt').extend({ lotId: z.uuid().optional() }).strict(),
    response: { status: 200, description: 'Page of grading records', schema: list(gradingSchema) },
    handler: async ({ query }) => {
      const r = await s.washing.listGrading(query);
      return { data: r.data, meta: { page: query.page, pageSize: query.pageSize, total: r.total } };
    },
  });

  api.route('Washing & grading', {
    method: 'post', path: '/grading/records', summary: 'Grade a washed lot into one child lot per parchment grade',
    description: 'Σ outputs ≤ washed output (+ `grading.outputTolerancePct`). Parent → GRADING / SPLIT; child lots `<lot>-<grade>` at GRADING. Events GRADED + LOT_SPLIT.',
    access: { permission: 'grading:record' }, idempotent: true,
    body: z.object({ lotId: z.uuid(), outputs: z.array(z.object({ gradeId: z.uuid(), weightKg: kgString }).strict()).min(1).max(10), notes }).strict(),
    response: { status: 201, description: 'Graded', schema: single(gradingSchema) },
    handler: async ({ body, user, meta }) => ({ data: await s.washing.grade(user, body, meta) }),
  });
}
