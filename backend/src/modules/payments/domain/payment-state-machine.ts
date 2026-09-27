import { BusinessRuleError } from '../../../common/errors.js';

/**
 * Supplier payment state machine (ARCHITECTURE.md §9.2):
 *   PENDING_APPROVAL → APPROVED → PAID → REVERSED (reversal cash entry)
 *   PENDING_APPROVAL → REJECTED
 * With payment.requiresApproval = false a payment is created directly as APPROVED.
 */
export const PAYMENT_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'PAID', 'REJECTED', 'REVERSED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type PaymentCommand = 'approve' | 'reject' | 'disburse' | 'reverse';

export const PAYMENT_TRANSITIONS: Record<PaymentCommand, { from: readonly PaymentStatus[]; to: PaymentStatus }> = {
  approve: { from: ['PENDING_APPROVAL'], to: 'APPROVED' },
  reject: { from: ['PENDING_APPROVAL'], to: 'REJECTED' },
  disburse: { from: ['APPROVED'], to: 'PAID' },
  reverse: { from: ['PAID'], to: 'REVERSED' },
};

/** A payment in one of these states blocks another payment for the same voucher (DB partial unique index). */
export const LIVE_PAYMENT_STATUSES: readonly PaymentStatus[] = ['PENDING_APPROVAL', 'APPROVED', 'PAID'];

export function nextPaymentStatus(current: PaymentStatus, command: PaymentCommand): PaymentStatus {
  if (!PAYMENT_TRANSITIONS[command].from.includes(current)) {
    throw new BusinessRuleError('INVALID_STATUS_TRANSITION', `A ${current} payment cannot be given "${command}"`, {
      status: current,
      command,
      allowedFrom: PAYMENT_TRANSITIONS[command].from,
    });
  }
  return PAYMENT_TRANSITIONS[command].to;
}
