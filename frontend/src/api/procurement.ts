import { http } from './client';
import type { Page } from './types';

/** Phase 2 (Procurement) API types — mirror the backend OpenAPI schemas; decimals are strings. */
type Data<T> = { data: T };
const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));

export type SupplierStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export const IDENTIFICATION_TYPES = ['NATIONAL_ID', 'LOCAL_ADMINISTRATION_ID', 'PASSPORT', 'OTHER'] as const;
export interface Supplier {
  id: string;
  supplierCode: string;
  fullName: string;
  phone: string | null;
  village: string | null;
  address: string | null;
  identificationType: (typeof IDENTIFICATION_TYPES)[number] | null;
  identificationNo: string | null;
  status: SupplierStatus;
  statusReason: string | null;
  qrToken: string;
  createdAt: string;
}
export interface SupplierInput {
  supplierCode?: string;
  fullName: string;
  phone?: string | null;
  village?: string | null;
  address?: string | null;
  identificationType?: Supplier['identificationType'];
  identificationNo?: string | null;
}
export interface SupplierDocument { id: string; documentId: string; docType: string; notes: string | null; originalName: string; createdAt: string }
export interface SupplierHistory {
  totals: { vouchers: number; purchasedKg: string; paidAmount: string };
  inspections: { id: string; inspectionNo: string; inspectedAt: string; decision: string; redRipePct: string }[];
  vouchers: { id: string; voucherNo: string; voucherDate: string; totalWeightKg: string; totalAmount: string; status: string }[];
  payments: { id: string; paymentNo: string; amount: string; status: string; voucherNo: string; paidAt: string | null }[];
}

export interface Inspection {
  id: string;
  inspectionNo: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  inspectorName: string;
  inspectedAt: string;
  redRipePct: string;
  greenUnripePct: string;
  overripeDamagedPct: string;
  gradeCode: string | null;
  decision: 'ACCEPTED' | 'REJECTED';
  rejectionReason: string | null;
  ruleEvaluation: { outcome: 'PASS' | 'WARN' | 'REJECT'; results: { name: string; triggered: boolean; action: string }[]; forcedRejection?: boolean };
  voucherId: string | null;
  voucherNo: string | null;
}

export type QualityMetric = 'RED_RIPE_PCT' | 'GREEN_UNRIPE_PCT' | 'OVERRIPE_DAMAGED_PCT';
export interface QualityRule {
  id: string;
  name: string;
  metric: QualityMetric;
  operator: 'LT' | 'LTE' | 'GT' | 'GTE';
  threshold: string;
  action: 'REJECT' | 'WARN';
  isActive: boolean;
  description: string | null;
}
export interface Grade { id: string; code: string; name: string; stage: 'CHERRY' | 'PARCHMENT'; sortOrder: number; isActive: boolean }
export interface CoffeeType { id: string; code: string; name: string; isActive: boolean }
export interface Hold {
  id: string;
  lotNumber: string;
  stage: string;
  reason: string;
  status: 'ACTIVE' | 'RELEASED';
  placedByName: string;
  placedAt: string;
  releasedByName: string | null;
  releasedAt: string | null;
  releaseNotes: string | null;
}

export type EquipmentStatus = 'OPERATIONAL' | 'UNDER_MAINTENANCE' | 'OUT_OF_SERVICE' | 'DECOMMISSIONED';
export const EQUIPMENT_TYPES = ['HOPPER', 'PULPING_MACHINE', 'FERMENTATION_TANK', 'MOISTURE_METER', 'OTHER', 'SCALE'] as const;
export const MAINTENANCE_TYPES = ['INSPECTION', 'CLEANING', 'CALIBRATION', 'PREVENTIVE', 'REPAIR'] as const;
export interface Equipment {
  id: string;
  code: string;
  name: string;
  type: (typeof EQUIPMENT_TYPES)[number];
  status: EquipmentStatus;
  location: string | null;
  serialNo: string | null;
  nextMaintenanceDueAt: string | null;
}
export interface Maintenance { id: string; type: string; performedAt: string; performedByName: string; description: string; result: string | null; cost: string | null }
export interface Schedule { id: string; type: string; intervalDays: number; lastPerformedAt: string | null; nextDueAt: string; isActive: boolean }

export interface Scale {
  id: string;
  code: string;
  name: string;
  status: EquipmentStatus;
  location: string | null;
  capacityKg: string;
  readabilityKg: string | null;
  lastVerifiedAt: string | null;
  lastResult: 'PASS' | 'FAIL' | null;
  verification: { verified: boolean; reason?: 'OUT_OF_SERVICE' | 'NEVER_VERIFIED' | 'LAST_CHECK_FAILED' | 'EXPIRED'; validUntil: string | null };
}
export interface Calibration {
  id: string;
  type: 'DAILY_VERIFICATION' | 'CALIBRATION';
  calibratedAt: string;
  standardWeightKg: string;
  readingKg: string;
  deviationKg: string;
  toleranceKg: string | null;
  result: 'PASS' | 'FAIL';
  performedByName: string;
  caNumber: string | null;
  notes: string | null;
}

export type VoucherStatus = 'DRAFT' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'APPROVED' | 'PAID' | 'CANCELLED' | 'VOIDED';
export interface VoucherSummary {
  id: string;
  voucherNo: string;
  voucherDate: string;
  supplierCode: string;
  supplierName: string;
  totalWeightKg: string;
  pricePerKg: string;
  totalAmount: string;
  status: VoucherStatus;
  scaleWarning: string | null;
  lotNumber: string | null;
  version: number;
}
export interface Weighing { id: string; scaleCode: string; grossKg: string; tareKg: string; netKg: string; weighedAt: string; scaleVerified: boolean }
export interface Voucher {
  id: string;
  voucherNo: string;
  voucherDate: string;
  status: VoucherStatus;
  version: number;
  supplierId: string;
  supplierCode: string;
  supplierNameSnap: string;
  coffeeTypeId: string;
  coffeeTypeName: string;
  qualityInspectionId: string;
  inspectionNo: string;
  qualityGradeId: string | null;
  gradeCode: string | null;
  totalWeightKg: string;
  pricePerKg: string;
  totalAmount: string;
  scaleWarning: string | null;
  createdByName: string;
  weighingClerkName: string;
  qualityInspectorName: string;
  verifiedByName: string | null;
  verifiedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  cashierName: string | null;
  cancelReason: string | null;
  items: { id: string; lineNo: number; coffeeTypeName: string; gradeCode: string | null; weightKg: string; pricePerKg: string; amount: string; weighings: Weighing[] }[];
  lot: { id: string; lotNumber: string; currentStage: string; status: string } | null;
  payments: { id: string; paymentNo: string; amount: string; status: string; method: string; paidAt: string | null }[];
}
export interface VoucherInput {
  qualityInspectionId: string;
  coffeeTypeId: string;
  qualityGradeId?: string | null;
  pricePerKg: string;
  items: { weighings: { scaleId: string; grossKg: string; tareKg?: string }[] }[];
}
export type VoucherCommand = 'submit' | 'verify' | 'return' | 'approve' | 'cancel' | 'void';
export interface PurchaseSummary {
  date: string;
  todayVouchers: number;
  todayKg: string;
  todayAmount: string;
  draft: number;
  pendingVerification: number;
  verified: number;
  approved: number;
}

export type PaymentStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'PAID' | 'REJECTED' | 'REVERSED';
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHEQUE'] as const;
export interface Payment {
  id: string;
  paymentNo: string;
  voucherId: string;
  voucherNo: string;
  supplierCode: string;
  supplierName: string;
  lotNumber: string | null;
  amount: string;
  method: (typeof PAYMENT_METHODS)[number];
  referenceNo: string | null;
  status: PaymentStatus;
  cashierName: string;
  approvedByName: string | null;
  paidAt: string | null;
  rejectReason: string | null;
  reversalReason: string | null;
  createdAt: string;
}
export type PaymentCommand = 'approve' | 'reject' | 'disburse' | 'reverse';
export interface CashTransaction { id: string; txnNumber: string; txnDate: string; direction: 'IN' | 'OUT'; type: string; amount: string; description: string; cashierName: string }

/** Random key so a retried click never pays twice (Idempotency-Key, ARCHITECTURE.md §8). */
export const idempotencyKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^\w-]/g, '');
const idem = (key: string) => ({ headers: { 'Idempotency-Key': key } });

export const suppliersApi = {
  list: (q: { page: number; pageSize: number; search?: string; status?: string }) => http.get<Page<Supplier>>('/suppliers', { params: clean(q) }).then((r) => r.data),
  get: (id: string) => http.get<Data<Supplier>>(`/suppliers/${id}`).then((r) => r.data.data),
  create: (body: SupplierInput) => http.post<Data<Supplier>>('/suppliers', body).then((r) => r.data.data),
  update: (id: string, body: Partial<SupplierInput>) => http.patch<Data<Supplier>>(`/suppliers/${id}`, body).then((r) => r.data.data),
  setStatus: (id: string, status: SupplierStatus, reason: string) => http.patch<Data<Supplier>>(`/suppliers/${id}/status`, { status, reason }).then((r) => r.data.data),
  documents: (id: string) => http.get<Data<SupplierDocument[]>>(`/suppliers/${id}/documents`).then((r) => r.data.data),
  addDocument: (id: string, documentId: string, docType: string) => http.post(`/suppliers/${id}/documents`, { documentId, docType }),
  history: (id: string) => http.get<Data<SupplierHistory>>(`/suppliers/${id}/history`).then((r) => r.data.data),
};

export const filesApi = {
  upload: (file: File, category: string) => {
    const form = new FormData();
    form.append('category', category);
    form.append('file', file);
    return http.post<Data<{ id: string }>>('/files', form).then((r) => r.data.data);
  },
};

export const qualityApi = {
  inspections: (q: { page: number; pageSize: number; supplierId?: string; decision?: string; available?: boolean }) =>
    http.get<Page<Inspection>>('/quality/inspections', { params: clean(q) }).then((r) => r.data),
  inspect: (body: { supplierId: string; redRipePct: string; greenUnripePct: string; overripeDamagedPct: string; decision: 'ACCEPTED' | 'REJECTED'; qualityGradeId?: string | null; rejectionReason?: string | null; notes?: string | null }) =>
    http.post<Data<Inspection>>('/quality/inspections', body).then((r) => r.data.data),
  rules: () => http.get<Data<QualityRule[]>>('/quality/rules').then((r) => r.data.data),
  createRule: (body: Omit<QualityRule, 'id' | 'isActive'>) => http.post<Data<QualityRule>>('/quality/rules', body).then((r) => r.data.data),
  updateRule: (id: string, body: Partial<Omit<QualityRule, 'id'>>) => http.patch<Data<QualityRule>>(`/quality/rules/${id}`, body).then((r) => r.data.data),
  grades: (stage?: 'CHERRY' | 'PARCHMENT') => http.get<Data<Grade[]>>('/quality/grades', { params: clean({ stage }) }).then((r) => r.data.data),
  createGrade: (body: { code: string; name: string; stage: 'CHERRY' | 'PARCHMENT' }) => http.post<Data<Grade>>('/quality/grades', body).then((r) => r.data.data),
  updateGrade: (id: string, body: { isActive?: boolean; name?: string }) => http.patch<Data<Grade>>(`/quality/grades/${id}`, body).then((r) => r.data.data),
  coffeeTypes: () => http.get<Data<CoffeeType[]>>('/coffee-types').then((r) => r.data.data),
  createCoffeeType: (body: { code: string; name: string }) => http.post<Data<CoffeeType>>('/coffee-types', body).then((r) => r.data.data),
  holds: (q: { page: number; pageSize: number; status?: string }) => http.get<Page<Hold>>('/quality/holds', { params: clean(q) }).then((r) => r.data),
  placeHold: (lotNumber: string, reason: string) => http.post<Data<Hold>>('/quality/holds', { lotNumber, reason }).then((r) => r.data.data),
  releaseHold: (id: string, notes: string) => http.post<Data<Hold>>(`/quality/holds/${id}/release`, { notes }).then((r) => r.data.data),
};

export const equipmentApi = {
  list: (q: { page: number; pageSize: number; type?: string; status?: string; search?: string }) =>
    http.get<Page<Equipment>>('/equipment', { params: clean(q) }).then((r) => r.data),
  create: (body: { code: string; name: string; type: string; location?: string | null; serialNo?: string | null }) =>
    http.post<Data<Equipment>>('/equipment', body).then((r) => r.data.data),
  update: (id: string, body: { status?: EquipmentStatus; reason?: string; name?: string; location?: string | null }) =>
    http.patch<Data<Equipment>>(`/equipment/${id}`, body).then((r) => r.data.data),
  maintenance: (id: string) => http.get<Data<Maintenance[]>>(`/equipment/${id}/maintenance`).then((r) => r.data.data),
  recordMaintenance: (id: string, body: { type: string; description: string; result?: 'PASS' | 'FAIL' | null; cost?: string | null }) =>
    http.post(`/equipment/${id}/maintenance`, body),
  schedules: (id: string) => http.get<Data<Schedule[]>>(`/equipment/${id}/schedules`).then((r) => r.data.data),
  createSchedule: (id: string, body: { type: string; intervalDays: number }) => http.post(`/equipment/${id}/schedules`, body),
};

export const scalesApi = {
  list: () => http.get<Data<Scale[]>>('/scales').then((r) => r.data.data),
  create: (body: { code: string; name: string; capacityKg: string; readabilityKg?: string | null; location?: string | null }) =>
    http.post<Data<Scale>>('/scales', body).then((r) => r.data.data),
  calibrations: (id: string) => http.get<Data<Calibration[]>>(`/scales/${id}/calibrations`).then((r) => r.data.data),
  verify: (id: string, body: { type: 'DAILY_VERIFICATION' | 'CALIBRATION'; standardWeightKg: string; readingKg: string; result?: 'PASS' | 'FAIL'; notes?: string | null }) =>
    http.post<Data<{ result: 'PASS' | 'FAIL'; deviationKg: string; correctiveAction: { caNumber: string } | null }>>(`/scales/${id}/calibrations`, body).then((r) => r.data.data),
};

export const purchasesApi = {
  list: (q: { page: number; pageSize: number; status?: string; search?: string; from?: string; to?: string }) =>
    http.get<Page<VoucherSummary>>('/purchases', { params: clean(q) }).then((r) => r.data),
  summary: () => http.get<Data<PurchaseSummary>>('/purchases/summary').then((r) => r.data.data),
  get: (id: string) => http.get<Data<Voucher>>(`/purchases/${id}`).then((r) => r.data.data),
  create: (body: VoucherInput, key: string) => http.post<Data<Voucher>>('/purchases', body, idem(key)).then((r) => r.data.data),
  update: (id: string, body: VoucherInput & { version: number }) => http.put<Data<Voucher>>(`/purchases/${id}`, body).then((r) => r.data.data),
  command: (id: string, cmd: VoucherCommand, version: number, reason?: string) =>
    http.post<Data<Voucher>>(`/purchases/${id}/${cmd}`, { version, ...(reason ? { reason } : {}) }).then((r) => r.data.data),
  pdf: (id: string) => http.get<Blob>(`/purchases/${id}/pdf`, { responseType: 'blob' }).then((r) => r.data),
};

export const paymentsApi = {
  list: (q: { page: number; pageSize: number; status?: string; voucherId?: string }) => http.get<Page<Payment>>('/payments', { params: clean(q) }).then((r) => r.data),
  create: (body: { voucherId: string; method: string; referenceNo?: string | null }, key: string) =>
    http.post<Data<Payment>>('/payments', body, idem(key)).then((r) => r.data.data),
  command: (id: string, cmd: PaymentCommand, key: string, reason?: string) =>
    http.post<Data<Payment>>(`/payments/${id}/${cmd}`, reason ? { reason } : {}, idem(key)).then((r) => r.data.data),
};

export const cashApi = {
  list: (q: { page: number; pageSize: number }) => http.get<Page<CashTransaction>>('/finance/cash', { params: q }).then((r) => r.data),
  summary: () => http.get<Data<{ balance: string; inToday: string; outToday: string }>>('/finance/cash/summary').then((r) => r.data.data),
  record: (body: { type: 'CASH_FUNDING' | 'CASH_RETURN'; amount: string; description: string }, key: string) =>
    http.post<Data<CashTransaction>>('/finance/cash', body, idem(key)).then((r) => r.data.data),
};
