import { BusinessRuleError } from './errors.js';

/**
 * Server time is authoritative (ARCHITECTURE.md §19): a client may backdate an
 * entry (e.g. weighing captured offline) by at most `ops.maxBackdateHours`, and
 * never date it in the future (1 minute of clock skew allowed).
 */
export function assertAcceptableEntryTime(at: Date, maxBackdateHours: number, now = new Date(), field = 'time'): void {
  if (at.getTime() > now.getTime() + 60_000) {
    throw new BusinessRuleError('FUTURE_DATED', `The ${field} cannot be in the future`, { [field]: at.toISOString() });
  }
  if (now.getTime() - at.getTime() > maxBackdateHours * 3_600_000) {
    throw new BusinessRuleError('BACKDATE_LIMIT_EXCEEDED', `The ${field} is older than the allowed ${maxBackdateHours} h (ops.maxBackdateHours)`, {
      [field]: at.toISOString(),
      maxBackdateHours,
    });
  }
}
