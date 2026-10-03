import type pg from 'pg';
import { businessDate } from '../../common/util.js';
import type { AuditLogService } from '../audit-log/audit-log.service.js';
import type { OutboxService } from '../outbox/outbox.service.js';
import type { SequenceService } from '../sequences/sequence.service.js';
import type { SettingsService } from '../settings/settings.service.js';

export type CorrectiveActionSource =
  | 'QUALITY_DEFECT' | 'WEIGHT_DISCREPANCY' | 'INVENTORY_DISCREPANCY' | 'MISSING_STOCK' | 'PROCESS_VIOLATION'
  | 'FAILED_CALIBRATION' | 'MOISTURE_PROBLEM' | 'AUDIT_FINDING';

export interface RaiseInput {
  source: CorrectiveActionSource;
  issue: string;
  correctiveAction: string;
  department: string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  raisedById: string;
  responsibleId: string;
  lotId?: string | null;
  calibrationId?: string | null;
  reconciliationId?: string | null;
  moistureRecordId?: string | null;
  defectRecordId?: string | null;
  sourceRef?: Record<string, unknown> | null;
}

/** Due-date offset used for automatic CAs while ca.defaultDueDays is UNSET (PROVISIONAL engineering default). */
export const AUTO_CA_FALLBACK_DUE_DAYS = 7;

/**
 * `raise()` is the single entry point every automatic trigger uses
 * (ARCHITECTURE.md §11.5). Triggers that the brief makes explicit (failed
 * calibration, audit findings) always call `raise()`; the others call
 * `raiseOrRecommend()`, which follows controls.correctiveActionMode. The full
 * workflow (start/resolve/verify/close, evidence, notifications) is Phase 7.
 */
export class CorrectiveActionsService {
  constructor(
    private readonly sequences: SequenceService,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * AUTO_CREATE → creates the CA; RECOMMEND (default) → emits a
   * "corrective-action.recommended" event with the prefilled draft (Phase 7 turns
   * it into a notification). Either way the caller gets back what happened.
   */
  async raiseOrRecommend(tx: pg.PoolClient, i: RaiseInput): Promise<{ mode: 'AUTO_CREATE' | 'RECOMMEND'; correctiveAction: { id: string; caNumber: string } | null }> {
    const mode = await this.settings.getIn<'AUTO_CREATE' | 'RECOMMEND'>(tx, 'controls.correctiveActionMode');
    if (mode === 'AUTO_CREATE') return { mode, correctiveAction: await this.raise(tx, i) };
    const ref = i.lotId ?? i.reconciliationId ?? i.raisedById;
    await this.outbox.emit(tx, {
      eventType: 'corrective-action.recommended', aggregate: i.lotId ? 'Lot' : i.reconciliationId ? 'HopperReconciliation' : 'User', aggregateId: ref,
      payload: { ...i },
    });
    return { mode, correctiveAction: null };
  }

  async raise(tx: pg.PoolClient, i: RaiseInput): Promise<{ id: string; caNumber: string }> {
    const tz = await this.settings.getIn<string>(tx, 'station.timezone');
    const dueDays = (await this.settings.getIn<number | null>(tx, 'ca.defaultDueDays')) ?? AUTO_CA_FALLBACK_DUE_DAYS;
    const dueDate = businessDate(new Date(Date.now() + dueDays * 86_400_000), tz);
    const caNumber = await this.sequences.next(tx, 'CA');
    const { rows } = await tx.query(
      `INSERT INTO corrective_actions (ca_number, issue, source, department, severity, lot_id, calibration_id, reconciliation_id,
                                       moisture_record_id, defect_record_id, source_ref, is_auto_generated, raised_by_id,
                                       responsible_id, corrective_action, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13,$14,$15) RETURNING id`,
      [caNumber, i.issue, i.source, i.department, i.severity ?? 'MEDIUM', i.lotId ?? null, i.calibrationId ?? null,
        i.reconciliationId ?? null, i.moistureRecordId ?? null, i.defectRecordId ?? null,
        i.sourceRef ? JSON.stringify(i.sourceRef) : null, i.raisedById, i.responsibleId, i.correctiveAction, dueDate],
    );
    const id = rows[0].id as string;
    await this.audit.record(tx, {
      userId: i.raisedById, action: 'CREATE', module: 'corrective-actions', entityType: 'CorrectiveAction', entityId: id,
      newValue: { caNumber, source: i.source, issue: i.issue, dueDate, automatic: true },
    });
    return { id, caNumber };
  }
}
