/**
 * Status → colour, fixed everywhere (docs/UI_REFRESH_SPEC.md §2.1):
 *   success (green) = done / passed / within target
 *   warning (amber) = waiting / approaching a limit
 *   error   (red)   = rejected / overdue / out of range / blocked
 *   info    (blue)  = in progress
 *   neutral (grey)  = cancelled / inactive
 *
 * Every enum the API returns is mapped per domain, because the same word can mean
 * different things (a supplier ACTIVE is good, a quality hold ACTIVE blocks a lot).
 */
export type StatusTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export type StatusDomain =
  | 'user' | 'supplier' | 'settingSource' | 'equipment' | 'checkResult' | 'inspection' | 'qualityRule' | 'hold'
  | 'voucher' | 'payment' | 'lot' | 'lotStage' | 'fermentation' | 'fermentationTiming' | 'mucilage' | 'reconciliation' | 'scaleCheck';

export const STATUS_TONES: Record<StatusDomain, Record<string, StatusTone>> = {
  user: { ACTIVE: 'success', LOCKED: 'error', INACTIVE: 'neutral' },
  supplier: { ACTIVE: 'success', SUSPENDED: 'warning', INACTIVE: 'neutral' },
  settingSource: { CONFIRMED: 'success', MANUAL: 'info', PROVISIONAL: 'warning', UNSET: 'error' },
  equipment: { OPERATIONAL: 'success', UNDER_MAINTENANCE: 'warning', OUT_OF_SERVICE: 'error', DECOMMISSIONED: 'neutral' },
  checkResult: { PASS: 'success', FAIL: 'error' },
  inspection: { ACCEPTED: 'success', REJECTED: 'error', WARN: 'warning' },
  qualityRule: { REJECT: 'error', WARN: 'warning' },
  hold: { ACTIVE: 'error', RELEASED: 'neutral' },
  voucher: {
    DRAFT: 'info', PENDING_VERIFICATION: 'warning', VERIFIED: 'warning', APPROVED: 'success', PAID: 'success',
    CANCELLED: 'neutral', VOIDED: 'neutral',
  },
  payment: { PENDING_APPROVAL: 'warning', APPROVED: 'warning', PAID: 'success', REJECTED: 'error', REVERSED: 'neutral' },
  lot: { ACTIVE: 'info', ON_HOLD: 'error', SPLIT: 'success', IN_STORE: 'success', RELEASED: 'success', REJECTED: 'error', CLOSED: 'neutral' },
  lotStage: {
    PURCHASED: 'warning', HOPPER: 'info', FLOTATION: 'info', PULPING: 'info', FERMENTATION: 'info', WASHING: 'info', GRADING: 'info',
    DRYING: 'info', FINAL_MOISTURE_VERIFIED: 'success', WAREHOUSE: 'success', RELEASED: 'success',
  },
  fermentation: { IN_PROGRESS: 'info', COMPLETED: 'success', CANCELLED: 'neutral' },
  fermentationTiming: { BEFORE_MIN: 'info', IN_WINDOW: 'success', APPROACHING_MAX: 'warning', OVERDUE: 'error' },
  mucilage: { NOT_ASSESSED: 'neutral', INCOMPLETE: 'warning', COMPLETE: 'success' },
  reconciliation: { BALANCED: 'success', DISCREPANCY: 'error', REVIEWED: 'success' },
  /** Scale board: may it be used for weighing right now? */
  scaleCheck: { VERIFIED: 'success', DUE: 'warning', OUT_OF_SERVICE: 'error' },
};

/**
 * Fallback when a caller gives no domain: the first domain that knows the value,
 * in the order above (kept for screens not yet moved to the new StatusChip).
 */
const ANY: Record<string, StatusTone> = Object.assign({}, ...Object.values(STATUS_TONES).reverse(), { ON_HOLD: 'error' });

export function statusTone(value: string, domain?: StatusDomain): StatusTone {
  return (domain ? STATUS_TONES[domain][value] : undefined) ?? ANY[value] ?? 'neutral';
}

/** MUI palette colour of a tone (`neutral` → the default grey chip). */
export function toneColor(tone: StatusTone): 'success' | 'warning' | 'error' | 'info' | 'default' {
  return tone === 'neutral' ? 'default' : tone;
}
