import { SegregationOfDutiesError } from '../../src/common/errors.js';
import { SOD_RULES, assertSegregation } from '../../src/common/policies/segregation-of-duties.js';

describe('segregation of duties (§11.3)', () => {
  it('allows distinct people', () => {
    expect(() => assertSegregation(SOD_RULES.PV_APPROVER, { approver: 'd', creator: 'a', weighingClerk: 'b', verifier: 'c' })).not.toThrow();
  });

  it.each([
    ['creator', { approver: 'a', creator: 'a', weighingClerk: 'b', verifier: 'c' }],
    ['weighingClerk', { approver: 'b', creator: 'a', weighingClerk: 'b', verifier: 'c' }],
    ['verifier', { approver: 'c', creator: 'a', weighingClerk: 'b', verifier: 'c' }],
  ])('blocks the voucher approver when they are the %s', (conflict, actors) => {
    try {
      assertSegregation(SOD_RULES.PV_APPROVER, actors);
      throw new Error('expected SoD error');
    } catch (e) {
      expect(e).toBeInstanceOf(SegregationOfDutiesError);
      expect((e as SegregationOfDutiesError).statusCode).toBe(403);
      expect((e as SegregationOfDutiesError).details).toEqual({ rule: 'PV_APPROVER', conflictsWith: [conflict] });
    }
  });

  it('ignores roles not yet filled on the record', () => {
    expect(() => assertSegregation(SOD_RULES.PAYROLL_CASHIER, { cashierApprover: 'x', preparer: 'p', supervisorApprover: null })).not.toThrow();
  });

  it('blocks the cashier who was the weighing clerk [MANUAL]', () => {
    expect(() => assertSegregation(SOD_RULES.PV_CASHIER_NOT_WEIGHING_CLERK, { cashier: 'u', weighingClerk: 'u' })).toThrow(SegregationOfDutiesError);
  });

  it('requires the acting user', () => {
    expect(() => assertSegregation(SOD_RULES.CA_VERIFIER, { responsible: 'x' })).toThrow(/actor/);
  });
});
