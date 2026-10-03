import type pg from 'pg';
import { NotFoundError } from '../../common/errors.js';
import { WET_STAGES, type LotStage, type LotStatus } from '../../core/lots/lot-stage.js';
import type { LotService } from '../../core/lots/lot.service.js';
import { camelize, camelizeRows } from '../../db/pool.js';
import { Where } from '../../db/where.js';
import { orderBy, pageClause, type PageQuery } from '../../http/schemas.js';
import { outturnPct } from '../processing/domain/wet-rules.js';

const LOT_SELECT = `
  SELECT l.id, l.lot_number, l.type, l.status, l.current_stage, l.current_weight_kg, l.original_cherry_weight_kg, l.processing_date,
         l.current_location, l.supplier_id, s.supplier_code, s.full_name AS supplier_name, l.parent_lot_id, pl.lot_number AS parent_lot_number,
         l.grade_id, g.code AS grade_code, l.purchase_voucher_id, pv.voucher_no, l.qr_token, l.version, l.created_at, l.updated_at,
         EXISTS (SELECT 1 FROM quality_holds h WHERE h.lot_id = l.id AND h.status = 'ACTIVE') AS on_hold
    FROM lots l
    LEFT JOIN suppliers s ON s.id = l.supplier_id
    LEFT JOIN lots pl ON pl.id = l.parent_lot_id
    LEFT JOIN coffee_grades g ON g.id = l.grade_id
    LEFT JOIN purchase_vouchers pv ON pv.id = l.purchase_voucher_id`;

const SORT = { lotNumber: 'l.lot_number', processingDate: 'l.processing_date', updatedAt: 'l.updated_at', createdAt: 'l.created_at' };

/** Read side of lots (ARCHITECTURE.md §10): list, board, detail, timeline, outturn so far. */
export class LotsQueryService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly lots: LotService,
  ) {}

  async list(q: PageQuery & { stage?: LotStage; status?: LotStatus; type?: string; supplierId?: string; search?: string }) {
    const w = new Where()
      .addIf(q.stage, 'l.current_stage = ?')
      .addIf(q.status, 'l.status = ?')
      .addIf(q.type, 'l.type = ?')
      .addIf(q.supplierId, 'l.supplier_id = ?')
      .addIf(q.search, '(l.lot_number ILIKE ? OR s.full_name ILIKE ? OR s.supplier_code ILIKE ?)', q.search && `%${q.search}%`);
    const { limit, offset } = pageClause(q);
    const [rows, count] = await Promise.all([
      this.pool.query(`${LOT_SELECT} ${w.sql} ORDER BY ${orderBy(q.sort, SORT)}, l.id LIMIT ${limit} OFFSET ${offset}`, w.args),
      this.pool.query(`SELECT count(*)::int AS n FROM lots l LEFT JOIN suppliers s ON s.id = l.supplier_id ${w.sql}`, w.args),
    ]);
    return { data: camelizeRows(rows.rows), total: count.rows[0].n as number };
  }

  /**
   * Wet-processing board: lots still moving through wet stages (ACTIVE or ON_HOLD),
   * with what the next step needs (open hopper intake, open pulping run, active batch).
   */
  async board() {
    const { rows } = await this.pool.query(
      `SELECT l.id, l.lot_number, l.type, l.status, l.current_stage, l.current_weight_kg, l.original_cherry_weight_kg, l.updated_at,
              s.full_name AS supplier_name, g.code AS grade_code,
              EXISTS (SELECT 1 FROM quality_holds h WHERE h.lot_id = l.id AND h.status = 'ACTIVE') AS on_hold,
              (SELECT hr.id FROM hopper_records hr WHERE hr.lot_id = l.id AND hr.flotation_at IS NULL) AS open_intake_id,
              (SELECT pr.id FROM pulping_records pr WHERE pr.lot_id = l.id AND pr.ended_at IS NULL LIMIT 1) AS open_pulping_id,
              (SELECT row_to_json(b) FROM (SELECT fb.id, fb.batch_number, fb.status, fb.start_at FROM fermentation_batches fb
                 WHERE fb.lot_id = l.id AND fb.status <> 'CANCELLED' ORDER BY fb.start_at DESC LIMIT 1) b) AS fermentation
         FROM lots l LEFT JOIN suppliers s ON s.id = l.supplier_id LEFT JOIN coffee_grades g ON g.id = l.grade_id
        WHERE l.current_stage::text = ANY($1::text[]) AND l.status IN ('ACTIVE', 'ON_HOLD')
        ORDER BY l.updated_at`,
      [WET_STAGES],
    );
    const lots = camelizeRows<{ currentStage: string }>(rows);
    return { stages: WET_STAGES.map((stage) => ({ stage, lots: lots.filter((l) => l.currentStage === stage) })) };
  }

  async get(id: string) {
    const { rows } = await this.pool.query(`${LOT_SELECT} WHERE l.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundError('Lot', id);
    const children = await this.pool.query(
      `SELECT l.id, l.lot_number, l.current_stage, l.status, l.current_weight_kg, g.code AS grade_code
         FROM lots l LEFT JOIN coffee_grades g ON g.id = l.grade_id WHERE l.parent_lot_id = $1 ORDER BY g.sort_order, l.lot_number`,
      [id],
    );
    const hold = await this.lots.activeHold(this.pool, id);
    const lot = camelize<Record<string, unknown> & { type: string; gradeCode: string | null; currentWeightKg: string }>(rows[0]);
    return { ...lot, children: camelizeRows(children.rows), activeHold: hold };
  }

  /** Timeline of the lot and its ancestors (a grade lot shows the history of the lot it came from). */
  async events(id: string) {
    await this.get(id);
    const { rows } = await this.pool.query(
      `WITH RECURSIVE chain AS (
         SELECT id, parent_lot_id FROM lots WHERE id = $1
         UNION ALL SELECT l.id, l.parent_lot_id FROM lots l JOIN chain c ON l.id = c.parent_lot_id)
       SELECT e.id, e.lot_id, l.lot_number, e.sequence, e.event_type, e.stage, e.occurred_at, e.quantity_kg, e.ref_type, e.ref_id,
              e.location, e.payload, u.full_name AS user_name
         FROM lot_events e JOIN chain c ON c.id = e.lot_id JOIN lots l ON l.id = e.lot_id JOIN users u ON u.id = e.user_id
        ORDER BY e.occurred_at, e.sequence`,
      [id],
    );
    return camelizeRows(rows);
  }

  /** Weight at each step so far, as % of the root lot's original cherry weight (§11.2 outturn). */
  async outturn(id: string) {
    const lot = await this.get(id);
    const { rows: rootRows } = await this.pool.query(
      `WITH RECURSIVE chain AS (
         SELECT id, parent_lot_id, 0 AS depth FROM lots WHERE id = $1
         UNION ALL SELECT l.id, l.parent_lot_id, c.depth + 1 FROM lots l JOIN chain c ON l.id = c.parent_lot_id)
       SELECT id FROM chain ORDER BY depth DESC LIMIT 1`,
      [id],
    );
    const rootId = rootRows[0].id as string;
    const { rows } = await this.pool.query(
      `SELECT r.original_cherry_weight_kg AS purchased,
              (SELECT intake_kg FROM hopper_records WHERE lot_id = r.id) AS intake,
              (SELECT sinkers_kg FROM hopper_records WHERE lot_id = r.id) AS sinkers,
              (SELECT output_kg FROM pulping_records WHERE lot_id = r.id ORDER BY started_at DESC LIMIT 1) AS pulped,
              (SELECT output_kg FROM washing_records WHERE lot_id = r.id ORDER BY washed_at DESC LIMIT 1) AS washed,
              (SELECT total_output_kg FROM grading_records WHERE lot_id = r.id) AS graded
         FROM lots r WHERE r.id = $1`,
      [rootId],
    );
    const r = rows[0];
    const original = r.purchased as string;
    const step = (key: string, label: string, weight: string | null) => ({ key, label, weightKg: weight, outturnPct: weight ? outturnPct(weight, original) : null });
    const steps = [
      step('PURCHASED', 'Cherry purchased', r.purchased),
      step('HOPPER', 'Hopper intake', r.intake),
      step('FLOTATION', 'Sinkers after flotation', r.sinkers),
      step('PULPING', 'Pulped', r.pulped),
      step('WASHING', 'Washed', r.washed),
      step('GRADING', 'Graded (all grades)', r.graded),
    ];
    if (lot.type === 'GRADE_SPLIT') steps.push(step('GRADE', `This grade (${lot.gradeCode ?? ''})`, lot.currentWeightKg));
    return { lotId: id, rootLotId: rootId, originalCherryWeightKg: original, steps };
  }
}
