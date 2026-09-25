import { z } from 'zod';

/**
 * Setting registry — ARCHITECTURE.md §20. Seeds `system_settings` and validates
 * every change. `source`:
 *   MANUAL      value given in the brief/manual
 *   PROVISIONAL engineering default, shown on the "settings to confirm" banner
 *   UNSET       must be configured; value is null and the documented fallback applies
 *   CONFIRMED   (runtime only) a Site Manager/Admin confirmed or changed the value
 */
export type SettingSource = 'MANUAL' | 'PROVISIONAL' | 'UNSET' | 'CONFIRMED';
export type SettingValueType = 'NUMBER' | 'STRING' | 'BOOLEAN' | 'ENUM' | 'JSON';

export interface SettingDef {
  key: string;
  category: string;
  valueType: SettingValueType;
  defaultValue: unknown; // null when UNSET
  source: Exclude<SettingSource, 'CONFIRMED'>;
  description: string;
  /** Validates a new (non-null) value. */
  schema: z.ZodType;
  /** Allowed values shown in the UI for ENUM settings. */
  options?: readonly string[];
}

/** Categories whose keys need settings:manage-system (SUPER_ADMIN); everything else is a business key. */
export const SYSTEM_CATEGORIES = new Set(['auth', 'numbering', 'notifications', 'station']);

const pct = z.number().min(0).max(100);
const nonNegKg = z.number().min(0);
const hours = z.number().min(0).max(24 * 14);
const duration = z.string().regex(/^\d+[smhd]$/, 'use a duration such as 15m, 12h or 7d');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM (24h)');

function enumSetting(
  key: string, category: string, options: readonly [string, ...string[]], def: string,
  source: SettingDef['source'], description: string,
): SettingDef {
  return { key, category, valueType: 'ENUM', defaultValue: def, source, description, schema: z.enum(options), options };
}

const AUDIT_AREAS = ['FINANCE', 'INVENTORY', 'PRODUCTION', 'QUALITY', 'WAREHOUSE', 'PAYROLL'] as const;

export const SETTINGS: SettingDef[] = [
  // Station
  { key: 'station.timezone', category: 'station', valueType: 'STRING', defaultValue: 'Africa/Addis_Ababa', source: 'PROVISIONAL',
    description: 'IANA timezone that defines business-day boundaries (scale verification, reconciliation, attendance, reports).',
    schema: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'unknown timezone') },
  // Finance
  { key: 'finance.currency', category: 'finance', valueType: 'STRING', defaultValue: 'ETB', source: 'PROVISIONAL',
    description: 'Display/export currency code.', schema: z.string().regex(/^[A-Z]{3}$/) },
  enumSetting('finance.roundingMode', 'finance', ['HALF_UP', 'HALF_EVEN', 'DOWN'], 'HALF_UP', 'PROVISIONAL',
    'Rounding for money (2 dp) and weight (3 dp).'),
  // Numbering
  { key: 'numbering.formats', category: 'numbering', valueType: 'JSON', source: 'PROVISIONAL',
    description: 'Document number formats. Tokens: {YYYY} {YY} {MM} {DD} {YYMMDD} {SEQn}; child lots use {PARENT}-{GRADE}.',
    defaultValue: {
      PV: 'PV-{YYYY}-{SEQ6}', PAY: 'PAY-{YYYY}-{SEQ6}', QI: 'QI-{YYYY}-{SEQ6}', LOT: 'LOT-{YYMMDD}-{SEQ4}',
      LOT_CHILD: '{PARENT}-{GRADE}', FB: 'FB-{YYMMDD}-{SEQ3}', DB: 'DB-{YYMMDD}-{SEQ3}', SRV: 'SRV-{YYYY}-{SEQ6}',
      BC: 'BC-{YYYY}-{SEQ5}', INV: 'INV-{YYYY}-{SEQ7}', TRF: 'TRF-{YYYY}-{SEQ5}', CASH: 'CSH-{YYYY}-{SEQ6}',
      PR: 'PR-{YYYY}-{SEQ4}', SIV: 'SIV-{YYYY}-{SEQ6}', EXP: 'EXP-{YYYY}-{SEQ6}', AUD: 'AUD-{YYYY}-{SEQ4}',
      CA: 'CA-{YYYY}-{SEQ5}',
    },
    schema: z.record(z.string().regex(/^[A-Z_]+$/), z.string().min(3).max(60)) },
  // Quality
  { key: 'quality.percentSumTolerance', category: 'quality', valueType: 'NUMBER', defaultValue: 0.5, source: 'PROVISIONAL',
    description: 'Allowed deviation of red + green + overripe from 100 %.', schema: z.number().min(0).max(10) },
  // Scales
  { key: 'scale.verificationFrequencyHours', category: 'scale', valueType: 'NUMBER', defaultValue: 24, source: 'MANUAL',
    description: 'Daily scale verification [MANUAL: daily]: validity window in hours.', schema: z.number().positive().max(168) },
  { key: 'scale.verificationToleranceKg', category: 'scale', valueType: 'NUMBER', defaultValue: null, source: 'UNSET',
    description: 'Max |reading − standard|. UNSET: the verifier records PASS/FAIL explicitly.', schema: nonNegKg.max(100) },
  enumSetting('scale.unverifiedPolicy', 'scale', ['BLOCK', 'WARN'], 'BLOCK', 'PROVISIONAL',
    'Weighing on a scale without valid verification: BLOCK (422) or WARN (allowed, flagged, notified).'),
  // Purchasing & payments
  enumSetting('purchase.lotCreationTrigger', 'purchase', ['ON_PAYMENT', 'ON_APPROVAL'], 'ON_PAYMENT', 'MANUAL',
    'When the root lot is created (brief workflow order: after payment).'),
  { key: 'payment.requiresApproval', category: 'payment', valueType: 'BOOLEAN', defaultValue: true, source: 'PROVISIONAL',
    description: 'Supplier payments need approval before disbursement.', schema: z.boolean() },
  // Hopper
  { key: 'hopper.reconciliationTolerancePct', category: 'hopper', valueType: 'NUMBER', defaultValue: 0, source: 'UNSET',
    description: 'Purchased vs hopper intake tolerance. 0 = strict: every difference is flagged.', schema: pct },
  { key: 'hopper.flotationBalanceTolerancePct', category: 'hopper', valueType: 'NUMBER', defaultValue: 0, source: 'UNSET',
    description: 'Floaters + sinkers vs intake tolerance. 0 = strict.', schema: pct },
  { key: 'hopper.reconciliationRunTime', category: 'hopper', valueType: 'STRING', defaultValue: '20:00', source: 'PROVISIONAL',
    description: 'Daily reconciliation job time (station timezone).', schema: hhmm },
  // Pulping & fermentation
  enumSetting('pulping.dailyInspectionPolicy', 'pulping', ['BLOCK', 'WARN'], 'BLOCK', 'PROVISIONAL',
    'Pulping without today\'s passing machine inspection: BLOCK or WARN (+ corrective action).'),
  { key: 'fermentation.minHours', category: 'fermentation', valueType: 'NUMBER', defaultValue: 24, source: 'MANUAL',
    description: 'Typical minimum fermentation duration [MANUAL: 24–48 h].', schema: hours },
  { key: 'fermentation.maxHours', category: 'fermentation', valueType: 'NUMBER', defaultValue: 48, source: 'MANUAL',
    description: 'Typical maximum fermentation duration [MANUAL: 24–48 h].', schema: hours },
  { key: 'fermentation.approachingLeadHours', category: 'fermentation', valueType: 'NUMBER', defaultValue: 2, source: 'PROVISIONAL',
    description: 'Alert this many hours before the maximum.', schema: hours },
  { key: 'fermentation.requireMucilageCompleteToEnd', category: 'fermentation', valueType: 'BOOLEAN', defaultValue: true, source: 'PROVISIONAL',
    description: 'Completion requires mucilage assessment = COMPLETE.', schema: z.boolean() },
  { key: 'fermentation.sweetnessScale', category: 'fermentation', valueType: 'STRING', defaultValue: null, source: 'UNSET',
    description: 'Label for the sweetness measurement scale.', schema: z.string().max(100) },
  { key: 'fermentation.acidityScale', category: 'fermentation', valueType: 'STRING', defaultValue: null, source: 'UNSET',
    description: 'Label for the acidity measurement scale.', schema: z.string().max(100) },
  // Grading & drying
  { key: 'grading.outputTolerancePct', category: 'grading', valueType: 'NUMBER', defaultValue: 0, source: 'UNSET',
    description: 'Σ grade outputs ≤ washed output (+ tolerance). 0 = strict.', schema: pct },
  { key: 'drying.rakingIntervalMinutes', category: 'drying', valueType: 'NUMBER', defaultValue: 30, source: 'MANUAL',
    description: 'Raking interval [MANUAL: every 30 min].', schema: z.number().int().min(5).max(24 * 60) },
  { key: 'drying.activeHours', category: 'drying', valueType: 'JSON', defaultValue: null, source: 'UNSET',
    description: 'Hours when raking alerts run, e.g. {"start":"07:00","end":"18:00"}. UNSET: raking alerts off.',
    schema: z.object({ start: hhmm, end: hhmm }).strict() },
  { key: 'moisture.targetMinPct', category: 'moisture', valueType: 'NUMBER', defaultValue: 10.5, source: 'MANUAL',
    description: 'Target moisture lower bound [MANUAL 10.5 %].', schema: pct },
  { key: 'moisture.targetMaxPct', category: 'moisture', valueType: 'NUMBER', defaultValue: 11.5, source: 'MANUAL',
    description: 'Target moisture upper bound [MANUAL 11.5 %].', schema: pct },
  { key: 'moisture.warehouseMaxPct', category: 'moisture', valueType: 'NUMBER', defaultValue: 11.5, source: 'MANUAL',
    description: 'SRV hard block above this moisture [MANUAL 11.5 %].', schema: pct },
  { key: 'moisture.finalVerificationMaxAgeHours', category: 'moisture', valueType: 'NUMBER', defaultValue: null, source: 'UNSET',
    description: 'Latest reading must be this recent for final verification. UNSET: final verification is blocked until set.',
    schema: z.number().positive().max(168) },
  { key: 'defect.correctiveActionThresholdPct', category: 'defect', valueType: 'NUMBER', defaultValue: null, source: 'UNSET',
    description: 'Cumulative defect % per batch that raises a corrective action. UNSET: no automatic CA.', schema: pct },
  // Inventory & warehouse
  { key: 'inventory.adjustmentRequiresApproval', category: 'inventory', valueType: 'BOOLEAN', defaultValue: true, source: 'PROVISIONAL',
    description: 'Stock adjustments require approval.', schema: z.boolean() },
  { key: 'inventory.discrepancyCaThresholdPct', category: 'inventory', valueType: 'NUMBER', defaultValue: 0, source: 'UNSET',
    description: 'Adjustment size that raises a CA recommendation. 0 = strict (any adjustment).', schema: pct },
  { key: 'srv.requiresManagerApproval', category: 'srv', valueType: 'BOOLEAN', defaultValue: true, source: 'MANUAL',
    description: 'SRV needs manager approval [MANUAL field].', schema: z.boolean() },
  // Workforce
  { key: 'workforce.workersPerCapitaMin', category: 'workforce', valueType: 'NUMBER', defaultValue: 20, source: 'MANUAL',
    description: 'Warn when a group is smaller [MANUAL approx. 20–30].', schema: z.number().int().min(1).max(500) },
  { key: 'workforce.workersPerCapitaMax', category: 'workforce', valueType: 'NUMBER', defaultValue: 30, source: 'MANUAL',
    description: 'Warn when a group is larger [MANUAL approx. 20–30].', schema: z.number().int().min(1).max(500) },
  { key: 'payroll.dayCountStatuses', category: 'payroll', valueType: 'JSON', defaultValue: ['PRESENT'], source: 'PROVISIONAL',
    description: 'Attendance statuses that count as a paid day.',
    schema: z.array(z.enum(['PRESENT', 'ABSENT', 'EXCUSED'])).min(1) },
  { key: 'payroll.requireWorkerConfirmation', category: 'payroll', valueType: 'BOOLEAN', defaultValue: true, source: 'PROVISIONAL',
    description: 'Signature/thumbprint required before a payroll line is PAID.', schema: z.boolean() },
  // Controls
  enumSetting('audit.unannouncedFrequency', 'audit', ['DAILY', 'WEEKLY', 'MONTHLY'], 'WEEKLY', 'MANUAL',
    'Unannounced audit generation frequency.'),
  { key: 'audit.unannouncedAreas', category: 'audit', valueType: 'JSON', defaultValue: [...AUDIT_AREAS], source: 'MANUAL',
    description: 'Areas covered by unannounced audits.', schema: z.array(z.enum(AUDIT_AREAS)).min(1) },
  enumSetting('controls.correctiveActionMode', 'controls', ['AUTO_CREATE', 'RECOMMEND'], 'RECOMMEND', 'PROVISIONAL',
    'AUTO_CREATE or RECOMMEND (failed calibration and audit findings always create).'),
  { key: 'ca.defaultDueDays', category: 'ca', valueType: 'NUMBER', defaultValue: null, source: 'UNSET',
    description: 'Default CA due date offset. UNSET: due date entered manually.', schema: z.number().int().min(1).max(365) },
  // Notifications
  { key: 'notifications.emailEnabled', category: 'notifications', valueType: 'BOOLEAN', defaultValue: false, source: 'PROVISIONAL',
    description: 'Send e-mail notifications.', schema: z.boolean() },
  { key: 'notifications.smsEnabled', category: 'notifications', valueType: 'BOOLEAN', defaultValue: false, source: 'PROVISIONAL',
    description: 'Send SMS notifications (provider later).', schema: z.boolean() },
  // Operations
  { key: 'ops.maxBackdateHours', category: 'ops', valueType: 'NUMBER', defaultValue: 24, source: 'PROVISIONAL',
    description: 'Limit on backdated entries; server time is authoritative.', schema: z.number().min(0).max(24 * 31) },
  // Auth
  { key: 'auth.accessTokenTtl', category: 'auth', valueType: 'STRING', defaultValue: '15m', source: 'PROVISIONAL',
    description: 'Access JWT lifetime.', schema: duration },
  { key: 'auth.refreshTokenTtl', category: 'auth', valueType: 'STRING', defaultValue: '7d', source: 'PROVISIONAL',
    description: 'Refresh token lifetime (rotated on every use).', schema: duration },
  { key: 'auth.maxFailedLogins', category: 'auth', valueType: 'NUMBER', defaultValue: 5, source: 'PROVISIONAL',
    description: 'Failed logins before temporary lockout.', schema: z.number().int().min(1).max(50) },
  { key: 'auth.lockoutMinutes', category: 'auth', valueType: 'NUMBER', defaultValue: 15, source: 'PROVISIONAL',
    description: 'Temporary lockout duration.', schema: z.number().int().min(1).max(24 * 60) },
  { key: 'auth.passwordPolicy', category: 'auth', valueType: 'JSON', source: 'PROVISIONAL',
    defaultValue: { minLength: 10, requireLetter: true, requireDigit: true },
    description: 'Password rules for new and changed passwords.',
    schema: z.object({ minLength: z.number().int().min(8).max(128), requireLetter: z.boolean(), requireDigit: z.boolean() }).strict() },
];

export const SETTINGS_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

/** Cross-key rules checked when one side changes. */
export const SETTING_PAIRS: { min: string; max: string }[] = [
  { min: 'moisture.targetMinPct', max: 'moisture.targetMaxPct' },
  { min: 'fermentation.minHours', max: 'fermentation.maxHours' },
  { min: 'workforce.workersPerCapitaMin', max: 'workforce.workersPerCapitaMax' },
];

export interface PasswordPolicy {
  minLength: number;
  requireLetter: boolean;
  requireDigit: boolean;
}
