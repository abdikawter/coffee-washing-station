import type pg from 'pg';
import { BusinessRuleError, NotFoundError } from '../../common/errors.js';
import { kg } from '../../common/decimal.js';
import type { AuditLogService } from '../../core/audit-log/audit-log.service.js';
import type { CorrectiveActionsService } from '../../core/corrective-actions/corrective-actions.service.js';
import type { OutboxService } from '../../core/outbox/outbox.service.js';
import type { SettingsService } from '../../core/settings/settings.service.js';
import { camelize, camelizeRows, withTransaction } from '../../db/pool.js';
import type { AuthUser, RequestMeta } from '../../http/types.js';
import { evaluateCalibration, scaleVerificationAt, type CheckResult, type ScaleVerificationState } from './domain/scale-verification.js';
import type { EquipmentService } from './equipment.service.js';

const SCALE_SELECT = `
  SELECT s.id, s.equipment_id, s.capacity_kg, s.readability_kg, s.last_verified_at, s.last_result,
         e.code, e.name, e.status, e.location, e.serial_no
    FROM scales s JOIN equipment e ON e.id = s.equipment_id`;

interface ScaleRow {
  id: string;
  equipmentId: string;
  capacityKg: string;
  readabilityKg: string | null;
  lastVerifiedAt: Date | null;
  lastResult: CheckResult | null;
  code: string;
  name: string;
  status: string;
  location: string | null;
  serialNo: string | null;
}

/**
 * Scales and their daily verification (ARCHITECTURE.md §9.1 "Scale verification").
 * A FAIL takes the scale OUT_OF_SERVICE and always raises a FAILED_CALIBRATION
 * corrective action (§11.5); a later PASS puts it back into service.
 */
export class ScalesService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsService,
    private readonly equipment: EquipmentService,
    private readonly correctiveActions: CorrectiveActionsService,
    private readonly outbox: OutboxService,
  ) {}

  private withState(s: ScaleRow, frequencyHours: number, at = new Date()) {
    const latest = s.lastVerifiedAt && s.lastResult ? { calibratedAt: s.lastVerifiedAt, result: s.lastResult } : null;
    return { ...s, verification: scaleVerificationAt(s.status, latest, at, frequencyHours) };
  }

  async list(filter: { includeDecommissioned?: boolean } = {}) {
    const freq = await this.settings.get<number>('scale.verificationFrequencyHours');
    const { rows } = await this.pool.query(
      `${SCALE_SELECT} ${filter.includeDecommissioned ? '' : `WHERE e.status <> 'DECOMMISSIONED'`} ORDER BY e.code`,
    );
    return camelizeRows<ScaleRow>(rows).map((s) => this.withState(s, freq));
  }

  async get(id: string, db: pg.Pool | pg.PoolClient = this.pool) {
    const { rows } = await db.query(`${SCALE_SELECT} WHERE s.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundError('Scale', id);
    const freq = await this.settings.getIn<number>(db, 'scale.verificationFrequencyHours');
    return this.withState(camelize<ScaleRow>(rows[0]), freq);
  }

  async create(
    actor: AuthUser,
    input: { code: string; name: string; location?: string | null; serialNo?: string | null; capacityKg: string; readabilityKg?: string | null },
    meta: RequestMeta,
  ) {
    return withTransaction(this.pool, async (tx) => {
      const equipmentId = await this.equipment.insert(tx, { ...input, type: 'SCALE' });
      const { rows } = await tx.query(
        'INSERT INTO scales (equipment_id, capacity_kg, readability_kg) VALUES ($1, $2, $3) RETURNING id',
        [equipmentId, kg(input.capacityKg), input.readabilityKg ? kg(input.readabilityKg) : null],
      );
      const created = await this.get(rows[0].id, tx);
      await this.audit.record(tx, { userId: actor.id, action: 'CREATE', module: 'equipment', entityType: 'Scale', entityId: created.id, newValue: created, meta });
      return created;
    });
  }

  async update(actor: AuthUser, id: string, input: { capacityKg?: string; readabilityKg?: string | null }, meta: RequestMeta) {
    return withTransaction(this.pool, async (tx) => {
      const before = await this.get(id, tx);
      await tx.query(
        `UPDATE scales SET capacity_kg = COALESCE($2, capacity_kg), readability_kg = CASE WHEN $4 THEN $3 ELSE readability_kg END WHERE id = $1`,
        [id, input.capacityKg ?? null, input.readabilityKg ?? null, input.readabilityKg !== undefined],
      );
      const after = await this.get(id, tx);
      await this.audit.record(tx, {
        userId: actor.id, action: 'UPDATE', module: 'equipment', entityType: 'Scale', entityId: id,
        previousValue: { capacityKg: before.capacityKg, readabilityKg: before.readabilityKg },
        newValue: { capacityKg: after.capacityKg, readabilityKg: after.readabilityKg }, meta,
      });
      return after;
    });
  }

  async listCalibrations(scaleId: string) {
    await this.get(scaleId);
    const { rows } = await this.pool.query(
      `SELECT c.*, u.full_name AS performed_by_name, ca.id AS corrective_action_id, ca.ca_number
         FROM scale_calibrations c JOIN users u ON u.id = c.performed_by_id
         LEFT JOIN corrective_actions ca ON ca.calibration_id = c.id
        WHERE c.scale_id = $1 ORDER BY c.calibrated_at DESC LIMIT 200`,
      [scaleId],
    );
    return camelizeRows(rows);
  }

  async recordCalibration(
    actor: AuthUser, scaleId: string,
    input: {
      type: 'DAILY_VERIFICATION' | 'CALIBRATION'; standardWeightKg: string; readingKg: string; result?: CheckResult;
      certificateDocId?: string | null; notes?: string | null;
    },
    meta: RequestMeta,
  ) {
    return withTransaction(this.pool, async (tx) => {
      const { rows: locked } = await tx.query(
        `SELECT s.id, s.equipment_id, e.status, e.code FROM scales s JOIN equipment e ON e.id = s.equipment_id WHERE s.id = $1 FOR UPDATE OF s, e`,
        [scaleId],
      );
      const scale = locked[0];
      if (!scale) throw new NotFoundError('Scale', scaleId);
      if (scale.status === 'DECOMMISSIONED') throw new BusinessRuleError('EQUIPMENT_DECOMMISSIONED', 'The scale is decommissioned');
      if (input.certificateDocId) {
        const d = await tx.query('SELECT id FROM documents WHERE id = $1', [input.certificateDocId]);
        if (!d.rows[0]) throw new NotFoundError('Document', input.certificateDocId);
      }

      const toleranceKg = await this.settings.getIn<number | null>(tx, 'scale.verificationToleranceKg');
      const outcome = evaluateCalibration({ ...input, toleranceKg, manualResult: input.result });
      const now = new Date();
      const { rows } = await tx.query(
        `INSERT INTO scale_calibrations (scale_id, type, calibrated_at, standard_weight_kg, reading_kg, deviation_kg, tolerance_kg, result,
                                         performed_by_id, certificate_doc_id, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [scaleId, input.type, now, kg(input.standardWeightKg), kg(input.readingKg), outcome.deviationKg, toleranceKg, outcome.result,
          actor.id, input.certificateDocId ?? null, input.notes ?? null],
      );
      const calibrationId = rows[0].id as string;
      await tx.query('UPDATE scales SET last_verified_at = $2, last_result = $3 WHERE id = $1', [scaleId, now, outcome.result]);

      let correctiveAction: { id: string; caNumber: string } | null = null;
      if (outcome.result === 'FAIL') {
        await tx.query(`UPDATE equipment SET status = 'OUT_OF_SERVICE' WHERE id = $1 AND status <> 'DECOMMISSIONED'`, [scale.equipment_id]);
        correctiveAction = await this.correctiveActions.raise(tx, {
          source: 'FAILED_CALIBRATION', department: 'PROCUREMENT', severity: 'HIGH', calibrationId,
          issue: `Scale ${scale.code} failed ${input.type === 'DAILY_VERIFICATION' ? 'daily verification' : 'calibration'}: reading ${kg(input.readingKg)} kg vs standard ${kg(input.standardWeightKg)} kg`,
          correctiveAction: 'Take the scale out of use, recalibrate or repair it, and verify again before weighing.',
          raisedById: actor.id, responsibleId: actor.id,
        });
        await this.outbox.emit(tx, {
          eventType: 'scale.verification-failed', aggregate: 'Scale', aggregateId: scaleId,
          payload: { calibrationId, code: scale.code, correctiveActionId: correctiveAction.id },
        });
      } else if (scale.status === 'OUT_OF_SERVICE') {
        await tx.query(`UPDATE equipment SET status = 'OPERATIONAL' WHERE id = $1`, [scale.equipment_id]);
      }

      await this.audit.record(tx, {
        userId: actor.id, action: 'CREATE', module: 'equipment', entityType: 'ScaleCalibration', entityId: calibrationId,
        newValue: { scale: scale.code, ...input, ...outcome, toleranceKg, correctiveActionId: correctiveAction?.id ?? null }, meta,
      });
      return { calibrationId, ...outcome, toleranceKg, correctiveAction, scale: await this.get(scaleId, tx) };
    });
  }

  /**
   * Verification state of a scale at the moment of a weighing (used by purchasing):
   * the latest verification taken at or before `at`, within scale.verificationFrequencyHours.
   */
  async verificationAt(tx: pg.PoolClient, scaleId: string, at: Date): Promise<ScaleVerificationState & { code: string; capacityKg: string }> {
    const { rows } = await tx.query(
      `SELECT e.status, e.code, s.capacity_kg,
              (SELECT row_to_json(c) FROM (SELECT calibrated_at, result FROM scale_calibrations
                 WHERE scale_id = s.id AND calibrated_at <= $2 ORDER BY calibrated_at DESC LIMIT 1) c) AS latest
         FROM scales s JOIN equipment e ON e.id = s.equipment_id WHERE s.id = $1`,
      [scaleId, at],
    );
    if (!rows[0]) throw new NotFoundError('Scale', scaleId);
    const freq = await this.settings.getIn<number>(tx, 'scale.verificationFrequencyHours');
    const latest = rows[0].latest ? { calibratedAt: new Date(rows[0].latest.calibrated_at), result: rows[0].latest.result as CheckResult } : null;
    return { ...scaleVerificationAt(rows[0].status, latest, at, freq), code: rows[0].code, capacityKg: rows[0].capacity_kg };
  }

  /** Scales in service whose verification is missing, failed or expired (calibration-due job). */
  async dueForVerification(): Promise<{ id: string; code: string; reason: string | undefined }[]> {
    return (await this.list()).filter((s) => s.status === 'OPERATIONAL' && !s.verification.verified)
      .map((s) => ({ id: s.id, code: s.code, reason: s.verification.reason }));
  }
}
