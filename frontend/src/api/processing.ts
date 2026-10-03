import { http } from './client';
import { idempotencyKey } from './procurement';
import type { Page } from './types';

/** Phase 3 (wet processing) API types and calls — decimals are strings. */
type Data<T> = { data: T };
const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));
const idem = () => ({ headers: { 'Idempotency-Key': idempotencyKey() } });

export const WET_STAGES = ['PURCHASED', 'HOPPER', 'FLOTATION', 'PULPING', 'FERMENTATION', 'WASHING', 'GRADING'] as const;
export const LOT_STAGES = [...WET_STAGES, 'DRYING', 'FINAL_MOISTURE_VERIFIED', 'WAREHOUSE', 'RELEASED'] as const;
export type LotStage = (typeof LOT_STAGES)[number];
export type LotStatus = 'ACTIVE' | 'ON_HOLD' | 'SPLIT' | 'IN_STORE' | 'RELEASED' | 'REJECTED' | 'CLOSED';

export interface Lot {
  id: string;
  lotNumber: string;
  type: 'PURCHASE' | 'GRADE_SPLIT' | 'SPLIT';
  status: LotStatus;
  currentStage: LotStage;
  currentWeightKg: string;
  originalCherryWeightKg: string;
  processingDate: string;
  currentLocation: string | null;
  supplierName: string | null;
  supplierCode: string | null;
  parentLotId: string | null;
  parentLotNumber: string | null;
  gradeCode: string | null;
  purchaseVoucherId: string | null;
  voucherNo: string | null;
  onHold: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface LotDetail extends Lot {
  children: { id: string; lotNumber: string; currentStage: LotStage; status: LotStatus; currentWeightKg: string; gradeCode: string | null }[];
  activeHold: { id: string; reason: string; lotId: string } | null;
}
export interface LotEvent {
  id: string;
  lotId: string;
  lotNumber: string;
  sequence: number;
  eventType: string;
  stage: LotStage;
  occurredAt: string;
  quantityKg: string | null;
  location: string | null;
  payload: Record<string, unknown> | null;
  userName: string;
}
export interface Outturn { originalCherryWeightKg: string; steps: { key: string; label: string; weightKg: string | null; outturnPct: string | null }[] }

export interface BoardLot {
  id: string;
  lotNumber: string;
  type: Lot['type'];
  status: LotStatus;
  currentStage: LotStage;
  currentWeightKg: string;
  originalCherryWeightKg: string;
  supplierName: string | null;
  gradeCode: string | null;
  onHold: boolean;
  openIntakeId: string | null;
  openPulpingId: string | null;
  fermentation: { id: string; batch_number: string; status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'; start_at: string } | null;
}

export interface Unit {
  id: string;
  equipmentId: string;
  code: string;
  name: string;
  status: string;
  location: string | null;
  capacityKg?: string;
  activeBatch?: { batch_number: string; lot_number: string; start_at: string } | null;
  lastInspection?: { inspection_date: string; result: 'PASS' | 'FAIL' } | null;
}

export type TimingState = 'BEFORE_MIN' | 'IN_WINDOW' | 'APPROACHING_MAX' | 'OVERDUE';
export type Mucilage = 'NOT_ASSESSED' | 'INCOMPLETE' | 'COMPLETE';
export interface Batch {
  id: string;
  batchNumber: string;
  lotId: string;
  lotNumber: string;
  tankCode: string;
  inputKg: string;
  startAt: string;
  endAt: string | null;
  minDurationHours: string;
  maxDurationHours: string;
  mucilageAssessment: Mucilage;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  operatorName: string;
  timing: { elapsedHours: string; minEndAt: string; maxEndAt: string; state: TimingState };
  measurements?: { id: string; measuredAt: string; temperatureC: string | null; ph: string | null; sweetness: string | null; acidity: string | null; mucilageAssessment: Mucilage; measuredByName: string }[];
}

export interface Reconciliation {
  id: string;
  reconDate: string;
  purchasedCherryKg: string;
  hopperIntakeKg: string;
  differenceKg: string;
  differencePct: string;
  tolerancePct: string;
  status: 'BALANCED' | 'DISCREPANCY' | 'REVIEWED';
  detail: { lotNumber: string; purchasedKg: string; intakeKg: string; differenceKg: string; differencePct: string; flagged: boolean }[];
  reviewedByName: string | null;
  reviewNotes: string | null;
}
export interface CaResult { mode: 'AUTO_CREATE' | 'RECOMMEND'; correctiveAction: { id: string; caNumber: string } | null }

export const lotsApi = {
  list: (q: { page: number; pageSize: number; stage?: string; status?: string; type?: string; search?: string }) =>
    http.get<Page<Lot>>('/lots', { params: clean(q) }).then((r) => r.data),
  board: () => http.get<Data<{ stages: { stage: LotStage; lots: BoardLot[] }[] }>>('/lots/board').then((r) => r.data.data.stages),
  get: (id: string) => http.get<Data<LotDetail>>(`/lots/${id}`).then((r) => r.data.data),
  events: (id: string) => http.get<Data<LotEvent[]>>(`/lots/${id}/events`).then((r) => r.data.data),
  outturn: (id: string) => http.get<Data<Outturn>>(`/lots/${id}/outturn`).then((r) => r.data.data),
};

export type UnitKind = 'hoppers' | 'pulping/machines' | 'fermentation/tanks';
export const processingApi = {
  units: (kind: UnitKind) => http.get<Data<Unit[]>>(`/${kind}`).then((r) => r.data.data),
  createUnit: (kind: UnitKind, body: { code: string; name: string; location?: string | null; capacityKg?: string }) =>
    http.post<Data<Unit>>(`/${kind}`, body).then((r) => r.data.data),

  intake: (body: { lotId: string; hopperId: string; intakeKg: string; notes?: string | null }) =>
    http.post<Data<{ warnings: string[] }>>('/hopper/intakes', body, idem()).then((r) => r.data.data),
  flotation: (intakeId: string, body: { floatersKg: string; sinkersKg: string; notes?: string | null }) =>
    http.post<Data<{ balance: { differenceKg: string; differencePct: string; withinTolerance: boolean }; correctiveAction: CaResult | null }>>(`/hopper/intakes/${intakeId}/flotation`, body).then((r) => r.data.data),

  inspections: (machineId: string) => http.get<Data<{ id: string; inspectionDate: string; result: 'PASS' | 'FAIL'; discTeethOk: boolean; discSpacingOk: boolean; cleaningDone: boolean }[]>>(`/pulping/machines/${machineId}/inspections`).then((r) => r.data.data),
  inspect: (machineId: string, body: { discTeethOk: boolean; discSpacingOk: boolean; cleaningDone: boolean; discSpacingMm?: string | null; notes?: string | null }) =>
    http.post<Data<{ result: 'PASS' | 'FAIL' }>>(`/pulping/machines/${machineId}/inspections`, body).then((r) => r.data.data),
  pulp: (body: { lotId: string; machineId: string; inputKg?: string; outputKg?: string | null }) =>
    http.post<Data<{ inspectionProblem: 'MISSING' | 'FAILED' | null; correctiveAction: CaResult | null }>>('/pulping/records', body, idem()).then((r) => r.data.data),
  completePulping: (id: string, outputKg: string) => http.post(`/pulping/records/${id}/complete`, { outputKg }),

  batches: (q: { page: number; pageSize: number; status?: string }) => http.get<Page<Batch>>('/fermentation/batches', { params: clean(q) }).then((r) => r.data),
  batch: (id: string) => http.get<Data<Batch>>(`/fermentation/batches/${id}`).then((r) => r.data.data),
  startFermentation: (body: { lotId: string; tankId: string; expectedDurationHours?: number }) =>
    http.post<Data<Batch>>('/fermentation/batches', body, idem()).then((r) => r.data.data),
  measure: (id: string, body: { temperatureC?: string | null; ph?: string | null; sweetness?: string | null; acidity?: string | null; mucilageAssessment: Mucilage; notes?: string | null }) =>
    http.post<Data<Batch>>(`/fermentation/batches/${id}/measurements`, body).then((r) => r.data.data),
  completeFermentation: (id: string, body: { reason?: string }) =>
    http.post<Data<Batch & { correctiveAction: CaResult | null }>>(`/fermentation/batches/${id}/complete`, body).then((r) => r.data.data),

  wash: (body: { lotId: string; outputKg: string; densitySeparation?: string | null }) => http.post('/washing/records', body, idem()),
  grade: (body: { lotId: string; outputs: { gradeId: string; weightKg: string }[] }) =>
    http.post<Data<{ children: { id: string; lotNumber: string; grade: string; weightKg: string }[] }>>('/grading/records', body, idem()).then((r) => r.data.data),

  reconciliations: (q: { page: number; pageSize: number; status?: string }) => http.get<Page<Reconciliation>>('/hopper/reconciliations', { params: clean(q) }).then((r) => r.data),
  runReconciliation: (date?: string) => http.post<Data<Reconciliation & { correctiveAction: CaResult | null }>>('/hopper/reconciliations/run', date ? { date } : {}).then((r) => r.data.data),
  reviewReconciliation: (id: string, notes: string) => http.post<Data<Reconciliation>>(`/hopper/reconciliations/${id}/review`, { notes }).then((r) => r.data.data),
};
