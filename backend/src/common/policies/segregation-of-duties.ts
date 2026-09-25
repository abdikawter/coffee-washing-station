import { SegregationOfDutiesError } from '../errors.js';

/**
 * Segregation of duties — ARCHITECTURE.md §11.3. Applies to EVERY role,
 * including SUPER_ADMIN: holding two permissions never lets one user perform
 * both halves of a controlled pair on the same record.
 *
 * Services call `assertSegregation` inside their transaction (after locking the
 * record) so no endpoint can bypass it; migration 0011 repeats the rules as
 * CHECK constraints for defence in depth.
 */
export interface SodRule {
  /** Stable identifier, returned in error details. */
  code: string;
  /** The acting role in this step, e.g. "approver". */
  actor: string;
  /** Roles on the record the actor must differ from, e.g. ["creator", "weighingClerk"]. */
  mustDifferFrom: string[];
  message: string;
}

export const SOD_RULES = {
  PV_CASHIER_NOT_WEIGHING_CLERK: {
    code: 'PV_CASHIER_NOT_WEIGHING_CLERK', actor: 'cashier', mustDifferFrom: ['weighingClerk'],
    message: 'The cashier cannot be the weighing clerk of the voucher',
  },
  PV_VERIFIER: {
    code: 'PV_VERIFIER', actor: 'verifier', mustDifferFrom: ['creator', 'weighingClerk'],
    message: 'The verifier cannot be the creator or weighing clerk of the voucher',
  },
  PV_APPROVER: {
    code: 'PV_APPROVER', actor: 'approver', mustDifferFrom: ['creator', 'weighingClerk', 'verifier'],
    message: 'The approver cannot be the creator, weighing clerk or verifier of the voucher',
  },
  PAYMENT_APPROVER: {
    code: 'PAYMENT_APPROVER', actor: 'approver', mustDifferFrom: ['cashier'],
    message: 'The payment approver cannot be the paying cashier',
  },
  SRV_RECEIVER: {
    code: 'SRV_RECEIVER', actor: 'receiver', mustDifferFrom: ['deliverer'],
    message: 'The receiver cannot be the deliverer',
  },
  SRV_APPROVER: {
    code: 'SRV_APPROVER', actor: 'approver', mustDifferFrom: ['deliverer', 'receiver'],
    message: 'The SRV approver cannot be the deliverer or receiver',
  },
  TRANSFER_APPROVER: {
    code: 'TRANSFER_APPROVER', actor: 'approver', mustDifferFrom: ['requester'],
    message: 'The approver cannot be the requester',
  },
  PAYROLL_SUPERVISOR: {
    code: 'PAYROLL_SUPERVISOR', actor: 'supervisorApprover', mustDifferFrom: ['preparer'],
    message: 'The supervisor approver cannot be the preparer',
  },
  PAYROLL_CASHIER: {
    code: 'PAYROLL_CASHIER', actor: 'cashierApprover', mustDifferFrom: ['preparer', 'supervisorApprover'],
    message: 'The cashier approver cannot be the preparer or the supervisor approver',
  },
  ATTENDANCE_APPROVER: {
    code: 'ATTENDANCE_APPROVER', actor: 'approver', mustDifferFrom: ['recorder'],
    message: 'Attendance cannot be approved by the person who recorded it',
  },
  REQUEST_APPROVER: {
    code: 'REQUEST_APPROVER', actor: 'approver', mustDifferFrom: ['requester'],
    message: 'The approver cannot be the requester',
  },
  CA_VERIFIER: {
    code: 'CA_VERIFIER', actor: 'verifier', mustDifferFrom: ['responsible'],
    message: 'A corrective action cannot be verified by the person responsible for it',
  },
} as const satisfies Record<string, SodRule>;

/**
 * @param rule   the controlled step being performed
 * @param actors user ids of everyone already on the record plus the acting user
 *               (keys = the names used in the rule; null/undefined = nobody yet)
 */
export function assertSegregation(rule: SodRule, actors: Record<string, string | null | undefined>): void {
  const actor = actors[rule.actor];
  if (!actor) throw new Error(`SoD rule ${rule.code}: actor "${rule.actor}" missing`);
  const conflicts = rule.mustDifferFrom.filter((r) => actors[r] != null && actors[r] === actor);
  if (conflicts.length > 0) {
    throw new SegregationOfDutiesError(rule.message, { rule: rule.code, conflictsWith: conflicts });
  }
}
