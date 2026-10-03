import { z } from 'zod';
import { LOT_STAGES, LOT_STATUSES } from '../../core/lots/lot-stage.js';
import type { Api } from '../../http/api.js';
import { list, pagination, single, uuidParam } from '../../http/schemas.js';
import type { LotsQueryService } from './lots.service.js';

const lotSchema = z
  .looseObject({
    id: z.uuid(), lotNumber: z.string(), type: z.enum(['PURCHASE', 'GRADE_SPLIT', 'SPLIT']), status: z.enum(LOT_STATUSES),
    currentStage: z.enum(LOT_STAGES), currentWeightKg: z.string(), originalCherryWeightKg: z.string(), processingDate: z.string(),
    currentLocation: z.string().nullable(), supplierName: z.string().nullable(), parentLotId: z.uuid().nullable(),
    parentLotNumber: z.string().nullable(), gradeCode: z.string().nullable(), voucherNo: z.string().nullable(), onHold: z.boolean(),
    version: z.number().int(),
  })
  .meta({ id: 'Lot' });

const lotDetailSchema = lotSchema.extend({
  children: z.array(z.looseObject({ id: z.uuid(), lotNumber: z.string(), currentStage: z.string(), status: z.string(), currentWeightKg: z.string(), gradeCode: z.string().nullable() })),
  activeHold: z.object({ id: z.uuid(), lotId: z.uuid(), reason: z.string() }).nullable(),
}).meta({ id: 'LotDetail' });

const eventSchema = z
  .looseObject({
    id: z.uuid(), lotId: z.uuid(), lotNumber: z.string(), sequence: z.number().int(), eventType: z.string(), stage: z.enum(LOT_STAGES),
    occurredAt: z.date(), quantityKg: z.string().nullable(), refType: z.string(), refId: z.uuid(), location: z.string().nullable(),
    payload: z.unknown(), userName: z.string(),
  })
  .meta({ id: 'LotEvent' });

export function registerLotRoutes(api: Api, lots: LotsQueryService): void {
  api.route('Lots', {
    method: 'get', path: '/lots', summary: 'List lots',
    access: { permission: ['lot:read', 'lot:lookup'] },
    query: pagination(['lotNumber', 'processingDate', 'updatedAt', 'createdAt'] as const, '-createdAt').extend({
      stage: z.enum(LOT_STAGES).optional(), status: z.enum(LOT_STATUSES).optional(), type: z.enum(['PURCHASE', 'GRADE_SPLIT', 'SPLIT']).optional(),
      supplierId: z.uuid().optional(), search: z.string().trim().min(1).max(100).optional(),
    }).strict(),
    response: { status: 200, description: 'Page of lots', schema: list(lotSchema) },
    handler: async ({ query }) => {
      const r = await lots.list(query);
      return { data: r.data, meta: { page: query.page, pageSize: query.pageSize, total: r.total } };
    },
  });

  // Registered before /lots/:id so "board" is not taken for an id.
  api.route('Lots', {
    method: 'get', path: '/lots/board', summary: 'Wet-processing board: lots per stage with what their next step needs',
    access: { permission: 'lot:read' },
    response: { status: 200, description: 'Board', schema: single(z.object({ stages: z.array(z.object({ stage: z.enum(LOT_STAGES), lots: z.array(z.record(z.string(), z.unknown())) })) })) },
    handler: async () => ({ data: await lots.board() }),
  });

  api.route('Lots', {
    method: 'get', path: '/lots/:id', summary: 'Lot detail with parent, child (grade) lots and active hold',
    access: { permission: ['lot:read', 'lot:lookup'] }, params: uuidParam,
    response: { status: 200, description: 'Lot', schema: single(lotDetailSchema) },
    handler: async ({ params }) => ({ data: await lots.get(params.id) }),
  });

  api.route('Lots', {
    method: 'get', path: '/lots/:id/events', summary: 'Event timeline of the lot and the lots it came from',
    access: { permission: 'lot:read' }, params: uuidParam,
    response: { status: 200, description: 'Events', schema: single(z.array(eventSchema)) },
    handler: async ({ params }) => ({ data: await lots.events(params.id) }),
  });

  api.route('Lots', {
    method: 'get', path: '/lots/:id/outturn', summary: 'Weight at each step so far as % of the original cherry',
    access: { permission: 'lot:read' }, params: uuidParam,
    response: {
      status: 200, description: 'Outturn',
      schema: single(z.object({
        lotId: z.uuid(), rootLotId: z.uuid(), originalCherryWeightKg: z.string(),
        steps: z.array(z.object({ key: z.string(), label: z.string(), weightKg: z.string().nullable(), outturnPct: z.string().nullable() })),
      })),
    },
    handler: async ({ params }) => ({ data: await lots.outturn(params.id) }),
  });
}
