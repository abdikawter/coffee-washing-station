import type pg from 'pg';
import { BusinessRuleError, NotFoundError } from '../../common/errors.js';
import type { AuditLogService } from '../../core/audit-log/audit-log.service.js';
import type { LotService } from '../../core/lots/lot.service.js';
import type { OutboxService } from '../../core/outbox/outbox.service.js';
import { camelize, camelizeRows, withTransaction } from '../../db/pool.js';
import { Where } from '../../db/where.js';
import { pageClause, type PageQuery } from '../../http/schemas.js';
import type { AuthUser, RequestMeta } from '../../http/types.js';

const HOLD_SELECT = `
  SELECT h.*, l.lot_number, pu.full_name AS placed_by_name, ru.full_name AS released_by_name
    FROM quality_holds h
    JOIN lots l ON l.id = h.lot_id
    JOIN users pu ON pu.id = h.placed_by_id
    LEFT JOIN users ru ON ru.id = h.released_by_id`;

/**
 * Quality holds (ARCHITECTURE.md §9.2): the Quality Inspector's authority to
 * stop a lot. An ACTIVE hold blocks every forward step of the lot and of its
 * children (`LotService.assertNotOnHold`). One active hold per lot (DB partial unique).
 */
export class HoldsService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditLogService,
    private readonly lots: LotService,
    private readonly outbox: OutboxService,
  ) {}

  async list(q: PageQuery & { status?: 'ACTIVE' | 'RELEASED'; lotId?: string }) {
    const w = new Where().addIf(q.status, 'h.status = ?').addIf(q.lotId, 'h.lot_id = ?');
    const { limit, offset } = pageClause(q);
    const [rows, count] = await Promise.all([
      this.pool.query(`${HOLD_SELECT} ${w.sql} ORDER BY h.placed_at DESC, h.id LIMIT ${limit} OFFSET ${offset}`, w.args),
      this.pool.query(`SELECT count(*)::int AS n FROM quality_holds h ${w.sql}`, w.args),
    ]);
    return { data: camelizeRows(rows.rows), total: count.rows[0].n as number };
  }

  private async get(db: pg.Pool | pg.PoolClient, id: string) {
    const { rows } = await db.query(`${HOLD_SELECT} WHERE h.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundError('Quality hold', id);
    return camelize(rows[0]);
  }

  async place(actor: AuthUser, input: { lotNumber: string; reason: string }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const { rows: lots } = await tx.query('SELECT id, lot_number, status, current_stage FROM lots WHERE lot_number = $1 FOR UPDATE', [input.lotNumber.trim()]);
      const lot = lots[0];
      if (!lot) throw new NotFoundError('Lot', input.lotNumber);
      if (['CLOSED', 'REJECTED', 'RELEASED'].includes(lot.status)) {
        throw new BusinessRuleError('LOT_NOT_HOLDABLE', `A ${lot.status} lot cannot be put on hold`);
      }
      const existing = await tx.query(`SELECT id FROM quality_holds WHERE lot_id = $1 AND status = 'ACTIVE'`, [lot.id]);
      if (existing.rows[0]) throw new BusinessRuleError('LOT_ALREADY_ON_HOLD', 'The lot already has an active hold', { holdId: existing.rows[0].id });

      const { rows } = await tx.query(
        `INSERT INTO quality_holds (lot_id, stage, reason, placed_by_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [lot.id, lot.current_stage, input.reason, actor.id],
      );
      const holdId = rows[0].id as string;
      if (lot.status === 'ACTIVE') await tx.query(`UPDATE lots SET status = 'ON_HOLD' WHERE id = $1`, [lot.id]);
      await this.lots.appendEvent(tx, {
        lotId: lot.id, eventType: 'QUALITY_HOLD_PLACED', stage: lot.current_stage, userId: actor.id,
        refType: 'QualityHold', refId: holdId, payload: { reason: input.reason },
      });
      await this.outbox.emit(tx, { eventType: 'quality.hold-placed', aggregate: 'Lot', aggregateId: lot.id, payload: { holdId, lotNumber: lot.lot_number } });
      await this.audit.record(tx, {
        userId: actor.id, action: 'HOLD', module: 'quality', entityType: 'QualityHold', entityId: holdId,
        newValue: { lotNumber: lot.lot_number, stage: lot.current_stage, reason: input.reason }, meta,
      });
      return this.get(tx, holdId);
    });
  }

  async release(actor: AuthUser, holdId: string, notes: string, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query('SELECT * FROM quality_holds WHERE id = $1 FOR UPDATE', [holdId]);
      const hold = rows[0];
      if (!hold) throw new NotFoundError('Quality hold', holdId);
      if (hold.status !== 'ACTIVE') throw new BusinessRuleError('HOLD_NOT_ACTIVE', 'The hold was already released');
      await tx.query(
        `UPDATE quality_holds SET status = 'RELEASED', released_by_id = $2, released_at = now(), release_notes = $3 WHERE id = $1`,
        [holdId, actor.id, notes],
      );
      const { rows: lot } = await tx.query(`UPDATE lots SET status = CASE WHEN status = 'ON_HOLD' THEN 'ACTIVE'::lot_status ELSE status END
                                             WHERE id = $1 RETURNING current_stage, lot_number`, [hold.lot_id]);
      await this.lots.appendEvent(tx, {
        lotId: hold.lot_id, eventType: 'QUALITY_HOLD_RELEASED', stage: lot[0].current_stage, userId: actor.id,
        refType: 'QualityHold', refId: holdId, payload: { notes },
      });
      await this.audit.record(tx, {
        userId: actor.id, action: 'RELEASE', module: 'quality', entityType: 'QualityHold', entityId: holdId,
        previousValue: { status: 'ACTIVE' }, newValue: { status: 'RELEASED', lotNumber: lot[0].lot_number, notes }, meta,
      });
      return this.get(tx, holdId);
    });
  }
}
