import type pg from 'pg';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../common/errors.js';
import { randomToken } from '../../common/util.js';
import type { AuditLogService } from '../../core/audit-log/audit-log.service.js';
import { camelize, camelizeRows, withTransaction } from '../../db/pool.js';
import { Where } from '../../db/where.js';
import { orderBy, pageClause, type PageQuery } from '../../http/schemas.js';
import type { AuthUser, RequestMeta } from '../../http/types.js';

export const SUPPLIER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export const IDENTIFICATION_TYPES = ['NATIONAL_ID', 'LOCAL_ADMINISTRATION_ID', 'PASSPORT', 'OTHER'] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

export interface SupplierView {
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
  registeredById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupplierInput {
  supplierCode: string;
  fullName: string;
  phone?: string | null;
  village?: string | null;
  address?: string | null;
  identificationType?: SupplierView['identificationType'];
  identificationNo?: string | null;
}

const SORT = { supplierCode: 's.supplier_code', fullName: 's.full_name', createdAt: 's.created_at' };

function checkIdentification(type: unknown, no: unknown): void {
  if ((type == null) !== (no == null)) {
    throw new ValidationError([{ location: 'body', path: 'identificationNo', message: 'identification type and number go together' }]);
  }
}

/** Farmers / suppliers of red cherry (ARCHITECTURE.md §9.1 "Supplier registration"). */
export class SuppliersService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditLogService,
  ) {}

  async list(q: PageQuery & { status?: SupplierStatus; search?: string }): Promise<{ data: SupplierView[]; total: number }> {
    const w = new Where()
      .addIf(q.status, 's.status = ?')
      .addIf(q.search, '(s.full_name ILIKE ? OR s.supplier_code ILIKE ? OR s.phone ILIKE ? OR s.village ILIKE ?)', q.search && `%${q.search}%`);
    const { limit, offset } = pageClause(q);
    const [rows, count] = await Promise.all([
      this.pool.query(`SELECT s.* FROM suppliers s ${w.sql} ORDER BY ${orderBy(q.sort, SORT)}, s.id LIMIT ${limit} OFFSET ${offset}`, w.args),
      this.pool.query(`SELECT count(*)::int AS n FROM suppliers s ${w.sql}`, w.args),
    ]);
    return { data: camelizeRows<SupplierView>(rows.rows), total: count.rows[0].n };
  }

  async get(id: string, db: pg.Pool | pg.PoolClient = this.pool): Promise<SupplierView> {
    const { rows } = await db.query('SELECT * FROM suppliers WHERE id = $1', [id]);
    if (!rows[0]) throw new NotFoundError('Supplier', id);
    return camelize<SupplierView>(rows[0]);
  }

  async create(actor: AuthUser, input: SupplierInput, meta: RequestMeta): Promise<SupplierView> {
    checkIdentification(input.identificationType ?? null, input.identificationNo ?? null);
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO suppliers (supplier_code, full_name, phone, village, address, identification_type, identification_no, qr_token, registered_by_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [input.supplierCode.trim().toUpperCase(), input.fullName.trim(), input.phone ?? null, input.village ?? null, input.address ?? null,
          input.identificationType ?? null, input.identificationNo?.trim() ?? null, randomToken(24), actor.id],
      );
      const created = camelize<SupplierView>(rows[0]);
      await this.audit.record(tx, { userId: actor.id, action: 'CREATE', module: 'suppliers', entityType: 'Supplier', entityId: created.id, newValue: created, meta });
      return created;
    });
  }

  async update(actor: AuthUser, id: string, input: Partial<Omit<SupplierInput, 'supplierCode'>>, meta: RequestMeta): Promise<SupplierView> {
    return withTransaction(this.pool, async (tx) => {
      const { rows: locked } = await tx.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [id]);
      if (!locked[0]) throw new NotFoundError('Supplier', id);
      const before = camelize<SupplierView>(locked[0]);
      const next = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) } as SupplierView;
      checkIdentification(next.identificationType, next.identificationNo);
      const { rows } = await tx.query(
        `UPDATE suppliers SET full_name = $2, phone = $3, village = $4, address = $5, identification_type = $6, identification_no = $7
          WHERE id = $1 RETURNING *`,
        [id, next.fullName.trim(), next.phone, next.village, next.address, next.identificationType, next.identificationNo?.trim() ?? null],
      );
      const after = camelize<SupplierView>(rows[0]);
      await this.audit.record(tx, { userId: actor.id, action: 'UPDATE', module: 'suppliers', entityType: 'Supplier', entityId: id, previousValue: before, newValue: after, meta });
      return after;
    });
  }

  async setStatus(actor: AuthUser, id: string, status: SupplierStatus, reason: string, meta: RequestMeta): Promise<SupplierView> {
    return withTransaction(this.pool, async (tx) => {
      const { rows: locked } = await tx.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [id]);
      if (!locked[0]) throw new NotFoundError('Supplier', id);
      const before = camelize<SupplierView>(locked[0]);
      if (before.status === status) throw new BusinessRuleError('STATUS_UNCHANGED', `The supplier is already ${status}`);
      const { rows } = await tx.query('UPDATE suppliers SET status = $2, status_reason = $3 WHERE id = $1 RETURNING *', [id, status, reason]);
      const after = camelize<SupplierView>(rows[0]);
      await this.audit.record(tx, {
        userId: actor.id, action: 'UPDATE', module: 'suppliers', entityType: 'Supplier', entityId: id,
        previousValue: { status: before.status }, newValue: { status, reason }, meta,
      });
      return after;
    });
  }

  async listDocuments(supplierId: string) {
    await this.get(supplierId);
    const { rows } = await this.pool.query(
      `SELECT sd.id, sd.supplier_id, sd.document_id, sd.doc_type, sd.notes, sd.created_at, d.original_name, d.mime_type, d.size_bytes
         FROM supplier_documents sd JOIN documents d ON d.id = sd.document_id
        WHERE sd.supplier_id = $1 ORDER BY sd.created_at DESC`,
      [supplierId],
    );
    return camelizeRows(rows);
  }

  /** Links an uploaded document (POST /files first) to the supplier. */
  async addDocument(actor: AuthUser, supplierId: string, input: { documentId: string; docType: string; notes?: string | null }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      await this.get(supplierId, tx);
      const doc = await tx.query('SELECT id, uploaded_by_id, entity_type, entity_id FROM documents WHERE id = $1 FOR UPDATE', [input.documentId]);
      if (!doc.rows[0]) throw new NotFoundError('Document', input.documentId);
      if (doc.rows[0].entity_id && doc.rows[0].entity_id !== supplierId) {
        throw new BusinessRuleError('DOCUMENT_ALREADY_LINKED', 'The document belongs to another record');
      }
      await tx.query(`UPDATE documents SET entity_type = 'Supplier', entity_id = $2 WHERE id = $1`, [input.documentId, supplierId]);
      const { rows } = await tx.query(
        `INSERT INTO supplier_documents (supplier_id, document_id, doc_type, notes) VALUES ($1, $2, $3, $4) RETURNING *`,
        [supplierId, input.documentId, input.docType.trim(), input.notes ?? null],
      );
      const created = camelize(rows[0]);
      await this.audit.record(tx, { userId: actor.id, action: 'CREATE', module: 'suppliers', entityType: 'SupplierDocument', entityId: rows[0].id, newValue: created, meta });
      return created;
    });
  }

  /** Purchases, payments and inspections of one supplier, most recent first. */
  async history(supplierId: string) {
    await this.get(supplierId);
    const [inspections, vouchers, payments, totals] = await Promise.all([
      this.pool.query(
        `SELECT id, inspection_no, inspected_at, red_ripe_pct, green_unripe_pct, overripe_damaged_pct, decision
           FROM quality_inspections WHERE supplier_id = $1 ORDER BY inspected_at DESC LIMIT 50`,
        [supplierId],
      ),
      this.pool.query(
        `SELECT id, voucher_no, voucher_date, total_weight_kg, total_amount, status
           FROM purchase_vouchers WHERE supplier_id = $1 ORDER BY voucher_date DESC, created_at DESC LIMIT 50`,
        [supplierId],
      ),
      this.pool.query(
        `SELECT p.id, p.payment_no, p.amount, p.status, p.method, p.paid_at, v.voucher_no
           FROM supplier_payments p JOIN purchase_vouchers v ON v.id = p.voucher_id
          WHERE v.supplier_id = $1 ORDER BY p.created_at DESC LIMIT 50`,
        [supplierId],
      ),
      this.pool.query(
        `SELECT count(*)::int AS vouchers,
                COALESCE(sum(total_weight_kg) FILTER (WHERE status IN ('APPROVED', 'PAID')), 0)::numeric(14,3)::text AS purchased_kg,
                COALESCE(sum(total_amount) FILTER (WHERE status = 'PAID'), 0)::numeric(14,2)::text AS paid_amount
           FROM purchase_vouchers WHERE supplier_id = $1`,
        [supplierId],
      ),
    ]);
    return {
      totals: camelize<{ vouchers: number; purchasedKg: string; paidAmount: string }>(totals.rows[0]),
      inspections: camelizeRows(inspections.rows),
      vouchers: camelizeRows(vouchers.rows),
      payments: camelizeRows(payments.rows),
    };
  }
}
