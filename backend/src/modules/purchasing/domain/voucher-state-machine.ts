import { BusinessRuleError } from '../../../common/errors.js';

/**
 * Purchase voucher state machine (ARCHITECTURE.md §9.2):
 *   DRAFT → PENDING_VERIFICATION → VERIFIED → APPROVED → PAID
 *   DRAFT | PENDING_VERIFICATION | VERIFIED → CANCELLED           (reason)
 *   PENDING_VERIFICATION | VERIFIED → DRAFT                        (returned for correction, reason)
 *   APPROVED → VOIDED                                              (reason; lot not beyond PURCHASED)
 *   PAID → APPROVED                                                (the payment was reversed)
 * A paid voucher is voided by reversing its payment first (PAID → APPROVED) and then voiding it.
 */
export const VOUCHER_STATUSES = ['DRAFT', 'PENDING_VERIFICATION', 'VERIFIED', 'APPROVED', 'PAID', 'CANCELLED', 'VOIDED'] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

export type VoucherCommand = 'update' | 'submit' | 'verify' | 'return' | 'approve' | 'cancel' | 'void' | 'pay' | 'reversePayment';

export const VOUCHER_TRANSITIONS: Record<VoucherCommand, { from: readonly VoucherStatus[]; to: VoucherStatus }> = {
  update: { from: ['DRAFT'], to: 'DRAFT' },
  submit: { from: ['DRAFT'], to: 'PENDING_VERIFICATION' },
  verify: { from: ['PENDING_VERIFICATION'], to: 'VERIFIED' },
  return: { from: ['PENDING_VERIFICATION', 'VERIFIED'], to: 'DRAFT' },
  approve: { from: ['VERIFIED'], to: 'APPROVED' },
  cancel: { from: ['DRAFT', 'PENDING_VERIFICATION', 'VERIFIED'], to: 'CANCELLED' },
  void: { from: ['APPROVED'], to: 'VOIDED' },
  pay: { from: ['APPROVED'], to: 'PAID' },
  reversePayment: { from: ['PAID'], to: 'APPROVED' },
};

export function canTransition(current: VoucherStatus, command: VoucherCommand): boolean {
  return VOUCHER_TRANSITIONS[command].from.includes(current);
}

/** Returns the next status or throws 422 INVALID_STATUS_TRANSITION. */
export function nextVoucherStatus(current: VoucherStatus, command: VoucherCommand): VoucherStatus {
  if (!canTransition(current, command)) {
    throw new BusinessRuleError('INVALID_STATUS_TRANSITION', `A ${current} voucher cannot be ${command === 'update' ? 'edited' : `given "${command}"`}`, {
      status: current,
      command,
      allowedFrom: VOUCHER_TRANSITIONS[command].from,
    });
  }
  return VOUCHER_TRANSITIONS[command].to;
}
