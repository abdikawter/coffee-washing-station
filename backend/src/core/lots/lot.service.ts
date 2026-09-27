import type pg from 'pg';
import { BusinessRuleError, NotFoundError } from '../../common/errors.js';
import { businessDate, randomToken } from '../../common/util.js';
import type { SequenceService } from '../sequences/sequence.service.js';
import type { SettingsService } from '../settings/settings.service.js';

export type LotStage =
  | 'PURCHASED' | 'HOPPER' | 'FLOTATION' | 'PULPING' | 'FERMENTATION' | 'WASHING' | 'GRADING'
  | 'DRYING' | 'FINAL_MOISTURE_VERIFIED' | 'WAREHOUSE' | 'RELEASED';

export type LotEventType =
  | 'PURCHASED' | 'HOPPER_RECEIVED' | 'FLOTATION_COMPLETED' | 'PULPED' | 'FERMENTATION_STARTED' | 'FERMENTATION_COMPLETED'
  | 'WASHED' | 'GRADED' | 'LOT_SPLIT' | 'DRYING_STARTED' | 'MOISTURE_CHECK' | 'DEFECT_RECORDED' | 'DRYING_COMPLETED'
  | 'FINAL_MOISTURE_VERIFIED' | 'WAREHOUSE_RECEIVED' | 'TRANSFERRED' | 'INVENTORY_ADJUSTED' | 'RELEASED'
  | 'QUALITY_HOLD_PLACED' | 'QUALITY_HOLD_RELEASED';

export interface LotEventInput {
  lotId: string;
  eventType: LotEventType;
  stage: LotStage;
  userId: string;
  refType: string;
  refId: string;
  quantityKg?: string | null;
  location?: string | null;
  payload?: Record<string, unknown> | null;
  occurredAt?: Date;
}

/**
 * Lots and the lot event spine (ARCHITECTURE.md §10). Phase 2 creates root lots
 * and records hold events; Phase 3 adds stage transitions on top of `appendEvent`.
 * Every method runs inside the caller's transaction.
 */
export class LotService {
  constructor(
    private readonly sequences: SequenceService,
    private readonly settings: SettingsService,
  ) {}

  /** Appends the next event of a lot (row lock on the lot serialises sequence numbers) and bumps its version. */
  async appendEvent(tx: pg.PoolClient, e: LotEventInput): Promise<{ id: string; sequence: number }> {
    const lock = await tx.query('SELECT id FROM lots WHERE id = $1 FOR UPDATE', [e.lotId]);
    if (!lock.rows[0]) throw new NotFoundError('Lot', e.lotId);
    const { rows } = await tx.query(
      `INSERT INTO lot_events (lot_id, sequence, event_type, stage, occurred_at, user_id, quantity_kg, ref_type, ref_id, location, payload)
       SELECT $1::uuid, COALESCE(max(sequence), 0) + 1, $2::lot_event_type, $3::lot_stage, $4::timestamptz, $5::uuid,
              $6::numeric, $7::text, $8::uuid, $9::text, $10::jsonb
         FROM lot_events WHERE lot_id = $1::uuid
       RETURNING id, sequence`,
      [e.lotId, e.eventType, e.stage, e.occurredAt ?? new Date(), e.userId, e.quantityKg ?? null, e.refType, e.refId,
        e.location ?? null, e.payload ? JSON.stringify(e.payload) : null],
    );
    await tx.query('UPDATE lots SET version = version + 1 WHERE id = $1', [e.lotId]);
    return rows[0];
  }

  /**
   * Root lot for a purchase voucher (one voucher → one lot), created in the same
   * transaction as the approval or payment that triggers it (purchase.lotCreationTrigger).
   */
  async createRootLot(
    tx: pg.PoolClient,
    voucher: { id: string; voucherNo: string; supplierId: string; totalWeightKg: string },
    userId: string,
  ): Promise<{ id: string; lotNumber: string }> {
    const existing = await tx.query('SELECT id, lot_number FROM lots WHERE purchase_voucher_id = $1', [voucher.id]);
    if (existing.rows[0]) return { id: existing.rows[0].id, lotNumber: existing.rows[0].lot_number };
    const now = new Date();
    const lotNumber = await this.sequences.next(tx, 'LOT', now);
    const tz = await this.settings.getIn<string>(tx, 'station.timezone');
    const { rows } = await tx.query(
      `INSERT INTO lots (lot_number, type, supplier_id, purchase_voucher_id, original_cherry_weight_kg, current_weight_kg,
                         processing_date, current_stage, status, qr_token)
       VALUES ($1, 'PURCHASE', $2, $3, $4, $4, $5, 'PURCHASED', 'ACTIVE', $6) RETURNING id, lot_number`,
      [lotNumber, voucher.supplierId, voucher.id, voucher.totalWeightKg, businessDate(now, tz), randomToken(24)],
    );
    const lot = { id: rows[0].id as string, lotNumber: rows[0].lot_number as string };
    await this.appendEvent(tx, {
      lotId: lot.id, eventType: 'PURCHASED', stage: 'PURCHASED', userId, quantityKg: voucher.totalWeightKg,
      refType: 'PurchaseVoucher', refId: voucher.id, payload: { voucherNo: voucher.voucherNo },
    });
    return lot;
  }

  /** The active quality hold on this lot or any ancestor (a hold on a parent also stops its children). */
  async activeHold(db: pg.Pool | pg.PoolClient, lotId: string): Promise<{ id: string; lotId: string; reason: string } | null> {
    const { rows } = await db.query(
      `WITH RECURSIVE chain AS (
         SELECT id, parent_lot_id FROM lots WHERE id = $1
         UNION ALL
         SELECT l.id, l.parent_lot_id FROM lots l JOIN chain c ON l.id = c.parent_lot_id)
       SELECT h.id, h.lot_id, h.reason FROM quality_holds h JOIN chain c ON c.id = h.lot_id
        WHERE h.status = 'ACTIVE' LIMIT 1`,
      [lotId],
    );
    return rows[0] ? { id: rows[0].id, lotId: rows[0].lot_id, reason: rows[0].reason } : null;
  }

  /** Every forward step of a lot calls this first (ARCHITECTURE.md §9.2 "QualityHold"). */
  async assertNotOnHold(db: pg.Pool | pg.PoolClient, lotId: string): Promise<void> {
    const hold = await this.activeHold(db, lotId);
    if (hold) throw new BusinessRuleError('LOT_ON_HOLD', 'The lot is on quality hold', { holdId: hold.id, heldLotId: hold.lotId, reason: hold.reason });
  }
}
