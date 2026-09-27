import { z } from 'zod';
import type { Api } from '../../http/api.js';
import { boolQuery, isoDateTime, kgString, list, moneyString, pagination, reasonSchema, single, uuidParam } from '../../http/schemas.js';
import { EQUIPMENT_STATUSES, EQUIPMENT_TYPES, MAINTENANCE_TYPES, type EquipmentService } from './equipment.service.js';
import type { ScalesService } from './scales.service.js';

const equipmentSchema = z
  .object({
    id: z.uuid(), code: z.string(), name: z.string(), type: z.enum(EQUIPMENT_TYPES), status: z.enum(EQUIPMENT_STATUSES),
    location: z.string().nullable(), serialNo: z.string().nullable(), responsibleEmployeeId: z.uuid().nullable(),
    responsibleEmployeeName: z.string().nullable(), nextMaintenanceDueAt: z.date().nullable(), createdAt: z.date(), updatedAt: z.date(),
  })
  .meta({ id: 'Equipment' });

const maintenanceSchema = z
  .object({
    id: z.uuid(), equipmentId: z.uuid(), type: z.enum(MAINTENANCE_TYPES), performedAt: z.date(), performedById: z.uuid(),
    performedByName: z.string().optional(), description: z.string(), result: z.enum(['PASS', 'FAIL']).nullable(),
    cost: z.string().nullable(), nextDueAt: z.date().nullable(), createdAt: z.date(),
  })
  .meta({ id: 'MachineMaintenance' });

const scheduleSchema = z
  .object({
    id: z.uuid(), equipmentId: z.uuid(), type: z.enum(MAINTENANCE_TYPES), intervalDays: z.number().int(), lastPerformedAt: z.date().nullable(),
    nextDueAt: z.date(), responsibleEmployeeId: z.uuid().nullable(), isActive: z.boolean(),
  })
  .meta({ id: 'MaintenanceSchedule' });

const verificationSchema = z.object({
  verified: z.boolean(),
  reason: z.enum(['OUT_OF_SERVICE', 'NEVER_VERIFIED', 'LAST_CHECK_FAILED', 'EXPIRED']).optional(),
  validUntil: z.date().nullable(),
});

const scaleSchema = z
  .object({
    id: z.uuid(), equipmentId: z.uuid(), code: z.string(), name: z.string(), status: z.enum(EQUIPMENT_STATUSES),
    location: z.string().nullable(), serialNo: z.string().nullable(), capacityKg: z.string(), readabilityKg: z.string().nullable(),
    lastVerifiedAt: z.date().nullable(), lastResult: z.enum(['PASS', 'FAIL']).nullable(), verification: verificationSchema,
  })
  .meta({ id: 'Scale' });

const calibrationSchema = z
  .object({
    id: z.uuid(), scaleId: z.uuid(), type: z.enum(['DAILY_VERIFICATION', 'CALIBRATION']), calibratedAt: z.date(),
    standardWeightKg: z.string(), readingKg: z.string(), deviationKg: z.string(), toleranceKg: z.string().nullable(),
    result: z.enum(['PASS', 'FAIL']), performedById: z.uuid(), performedByName: z.string(), certificateDocId: z.uuid().nullable(),
    notes: z.string().nullable(), correctiveActionId: z.uuid().nullable(), caNumber: z.string().nullable(),
  })
  .meta({ id: 'ScaleCalibration' });

const code = z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9._/-]+$/);
const text = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

export function registerEquipmentRoutes(api: Api, equipment: EquipmentService, scales: ScalesService): void {
  // ---------------- Equipment ----------------
  api.route('Equipment', {
    method: 'get', path: '/equipment', summary: 'List equipment',
    access: { permission: 'equipment:read' },
    query: pagination(['code', 'name', 'type', 'createdAt'] as const, 'code').extend({
      type: z.enum(EQUIPMENT_TYPES).optional(), status: z.enum(EQUIPMENT_STATUSES).optional(), search: z.string().trim().min(1).max(100).optional(),
    }).strict(),
    response: { status: 200, description: 'Page of equipment', schema: list(equipmentSchema) },
    handler: async ({ query }) => {
      const r = await equipment.list(query);
      return { data: r.data, meta: { page: query.page, pageSize: query.pageSize, total: r.total } };
    },
  });

  api.route('Equipment', {
    method: 'get', path: '/equipment/:id', summary: 'Get equipment',
    access: { permission: 'equipment:read' }, params: uuidParam,
    response: { status: 200, description: 'Equipment', schema: single(equipmentSchema) },
    handler: async ({ params }) => ({ data: await equipment.get(params.id) }),
  });

  api.route('Equipment', {
    method: 'post', path: '/equipment', summary: 'Register equipment (scales: use POST /scales)',
    access: { permission: 'equipment:manage' },
    body: z.object({
      code, name: z.string().trim().min(2).max(100), type: z.enum(EQUIPMENT_TYPES), location: text(100), serialNo: text(60),
      responsibleEmployeeId: z.uuid().nullable().optional(),
    }).strict(),
    response: { status: 201, description: 'Registered', schema: single(equipmentSchema) },
    handler: async ({ body, user, meta }) => ({ data: await equipment.create(user, body, meta) }),
  });

  api.route('Equipment', {
    method: 'patch', path: '/equipment/:id', summary: 'Update equipment or change its status',
    description: 'A status change needs a reason (audited).',
    access: { permission: 'equipment:manage' }, params: uuidParam,
    body: z.object({
      name: z.string().trim().min(2).max(100).optional(), location: text(100), serialNo: text(60),
      responsibleEmployeeId: z.uuid().nullable().optional(), status: z.enum(EQUIPMENT_STATUSES).optional(), reason: reasonSchema.optional(),
    }).strict()
      .refine((b) => Object.keys(b).some((k) => k !== 'reason'), 'nothing to update')
      .refine((b) => !b.status || !!b.reason, { path: ['reason'], message: 'a reason is required to change the status' }),
    response: { status: 200, description: 'Updated', schema: single(equipmentSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await equipment.update(user, params.id, body, meta) }),
  });

  api.route('Equipment', {
    method: 'get', path: '/equipment/:id/maintenance', summary: 'Maintenance history of a machine',
    access: { permission: 'equipment:read' }, params: uuidParam,
    response: { status: 200, description: 'Maintenance records', schema: single(z.array(maintenanceSchema)) },
    handler: async ({ params }) => ({ data: await equipment.listMaintenance(params.id) }),
  });

  api.route('Equipment', {
    method: 'post', path: '/equipment/:id/maintenance', summary: 'Record maintenance performed',
    description: 'Advances the active schedule of the same type.',
    access: { permission: 'equipment:maintenance-record' }, params: uuidParam,
    body: z.object({
      type: z.enum(MAINTENANCE_TYPES), performedAt: isoDateTime.optional(), description: z.string().trim().min(3).max(1000),
      result: z.enum(['PASS', 'FAIL']).nullable().optional(), cost: moneyString.nullable().optional(), nextDueAt: isoDateTime.nullable().optional(),
    }).strict(),
    response: { status: 201, description: 'Recorded', schema: single(maintenanceSchema) },
    handler: async ({ params, body, user, meta }) =>
      ({
        data: await equipment.recordMaintenance(user, params.id, {
          ...body, performedAt: body.performedAt ? new Date(body.performedAt) : new Date(), nextDueAt: body.nextDueAt ? new Date(body.nextDueAt) : null,
        }, meta),
      }),
  });

  api.route('Equipment', {
    method: 'get', path: '/equipment/:id/schedules', summary: 'Maintenance schedules of a machine',
    access: { permission: 'equipment:read' }, params: uuidParam,
    response: { status: 200, description: 'Schedules', schema: single(z.array(scheduleSchema)) },
    handler: async ({ params }) => ({ data: await equipment.listSchedules(params.id) }),
  });

  api.route('Equipment', {
    method: 'post', path: '/equipment/:id/schedules', summary: 'Create a maintenance schedule',
    access: { permission: 'equipment:manage' }, params: uuidParam,
    body: z.object({
      type: z.enum(MAINTENANCE_TYPES), intervalDays: z.number().int().min(1).max(3650), nextDueAt: isoDateTime.nullable().optional(),
      responsibleEmployeeId: z.uuid().nullable().optional(),
    }).strict(),
    response: { status: 201, description: 'Created', schema: single(scheduleSchema) },
    handler: async ({ params, body, user, meta }) =>
      ({ data: await equipment.createSchedule(user, params.id, { ...body, nextDueAt: body.nextDueAt ? new Date(body.nextDueAt) : null }, meta) }),
  });

  api.route('Equipment', {
    method: 'patch', path: '/maintenance-schedules/:id', summary: 'Update or deactivate a maintenance schedule',
    access: { permission: 'equipment:manage' }, params: uuidParam,
    body: z.object({
      intervalDays: z.number().int().min(1).max(3650).optional(), nextDueAt: isoDateTime.optional(),
      responsibleEmployeeId: z.uuid().nullable().optional(), isActive: z.boolean().optional(),
    }).strict().refine((b) => Object.keys(b).length > 0, 'nothing to update'),
    response: { status: 200, description: 'Updated', schema: single(scheduleSchema) },
    handler: async ({ params, body, user, meta }) =>
      ({ data: await equipment.updateSchedule(user, params.id, { ...body, nextDueAt: body.nextDueAt ? new Date(body.nextDueAt) : undefined }, meta) }),
  });

  // ---------------- Scales ----------------
  api.route('Scales', {
    method: 'get', path: '/scales', summary: 'Scales with their current verification status (status board)',
    access: { permission: 'scale:read' },
    query: z.object({ includeDecommissioned: boolQuery.optional() }).strict(),
    response: { status: 200, description: 'Scales', schema: single(z.array(scaleSchema)) },
    handler: async ({ query }) => ({ data: await scales.list(query) }),
  });

  api.route('Scales', {
    method: 'get', path: '/scales/:id', summary: 'Get a scale',
    access: { permission: 'scale:read' }, params: uuidParam,
    response: { status: 200, description: 'Scale', schema: single(scaleSchema) },
    handler: async ({ params }) => ({ data: await scales.get(params.id) }),
  });

  api.route('Scales', {
    method: 'post', path: '/scales', summary: 'Register a scale',
    access: { permission: 'scale:manage' },
    body: z.object({
      code, name: z.string().trim().min(2).max(100), location: text(100), serialNo: text(60), capacityKg: kgString, readabilityKg: kgString.nullable().optional(),
    }).strict(),
    response: { status: 201, description: 'Registered', schema: single(scaleSchema) },
    handler: async ({ body, user, meta }) => ({ data: await scales.create(user, body, meta) }),
  });

  api.route('Scales', {
    method: 'patch', path: '/scales/:id', summary: 'Update capacity / readability',
    access: { permission: 'scale:manage' }, params: uuidParam,
    body: z.object({ capacityKg: kgString.optional(), readabilityKg: kgString.nullable().optional() })
      .strict().refine((b) => Object.keys(b).length > 0, 'nothing to update'),
    response: { status: 200, description: 'Updated', schema: single(scaleSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await scales.update(user, params.id, body, meta) }),
  });

  api.route('Scales', {
    method: 'get', path: '/scales/:id/calibrations', summary: 'Verification and calibration history',
    access: { permission: 'scale:read' }, params: uuidParam,
    response: { status: 200, description: 'History', schema: single(z.array(calibrationSchema)) },
    handler: async ({ params }) => ({ data: await scales.listCalibrations(params.id) }),
  });

  api.route('Scales', {
    method: 'post', path: '/scales/:id/calibrations', summary: 'Record the daily verification (or a calibration)',
    description:
      'PASS if |reading − standard| ≤ `scale.verificationToleranceKg`. While that setting is UNSET, send `result` (PASS/FAIL). ' +
      'FAIL takes the scale out of service and raises a FAILED_CALIBRATION corrective action.',
    access: { permission: 'scale:verify' }, params: uuidParam,
    body: z.object({
      type: z.enum(['DAILY_VERIFICATION', 'CALIBRATION']).default('DAILY_VERIFICATION'), standardWeightKg: kgString, readingKg: kgString,
      result: z.enum(['PASS', 'FAIL']).optional(), certificateDocId: z.uuid().nullable().optional(), notes: z.string().trim().max(1000).nullable().optional(),
    }).strict(),
    response: {
      status: 201, description: 'Recorded',
      schema: single(z.object({
        calibrationId: z.uuid(), deviationKg: z.string(), result: z.enum(['PASS', 'FAIL']), resultSource: z.enum(['TOLERANCE', 'MANUAL']),
        toleranceKg: z.number().nullable(), correctiveAction: z.object({ id: z.uuid(), caNumber: z.string() }).nullable(), scale: scaleSchema,
      })),
    },
    handler: async ({ params, body, user, meta }) => ({ data: await scales.recordCalibration(user, params.id, body, meta) }),
  });
}
