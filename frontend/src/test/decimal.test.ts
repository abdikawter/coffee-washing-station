import type { Principal } from '../api/types';
import { visibleNav } from '../navigation';
import { add, formatNumber, isDecimal, multiplyMoney, subtract } from '../utils/decimal';

describe('decimal previews (never floats)', () => {
  it('computes net weights and totals exactly', () => {
    expect(subtract('50.1', '0.5')).toBe('49.600');
    expect(subtract('0.3', '0.1')).toBe('0.200'); // 0.3 - 0.1 in floats is 0.19999999999999998
    expect(add(['49.600', '39.700'])).toBe('89.300');
    expect(subtract('1', '2')).toBe('-1.000');
  });

  it('multiplies weight × price like the server (half-up to 2 dp)', () => {
    expect(multiplyMoney('89.300', '45.10')).toBe('4027.43');
    expect(multiplyMoney('0.5', '10.01')).toBe('5.01'); // 5.005 → 5.01
    expect(multiplyMoney('0.300', '0.1')).toBe('0.03');
  });

  it('validates and formats', () => {
    expect(isDecimal('12.345')).toBe(true);
    expect(isDecimal('12.3456')).toBe(false);
    expect(isDecimal('1e3')).toBe(false);
    expect(isDecimal('12.34', 2)).toBe(true);
    expect(formatNumber('1234567.5')).toBe('1,234,567.50');
    expect(formatNumber('89.3', 3)).toBe('89.300');
    expect(formatNumber(null)).toBe('—');
    // rounds half away from zero instead of truncating
    expect(formatNumber('950.5', 0)).toBe('951');
    expect(formatNumber('62.456', 1)).toBe('62.5');
    expect(formatNumber('-0.005', 2)).toBe('-0.01');
    expect(formatNumber('1.004', 2)).toBe('1.00');
  });
});

describe('procurement navigation', () => {
  const nav = (permissions: string[]) =>
    visibleNav({ id: '1', username: 'u', fullName: 'U', email: null, mustChangePassword: false, roles: [], permissions } as Principal).map((i) => i.label);

  it('shows the Phase 2 modules to the roles that use them', () => {
    // PURCHASING_CLERK (subset)
    expect(nav(['supplier:read', 'quality:read', 'scale:read', 'purchase:read', 'payment:read'])).toEqual(
      ['Dashboard', 'Suppliers', 'Quality', 'Scales', 'Purchasing', 'Payments'],
    );
    // PULPING_OPERATOR sees quality holds and equipment, not purchasing
    const operator = nav(['quality:hold-read', 'equipment:read', 'lot:read']);
    expect(operator).toEqual(expect.arrayContaining(['Quality', 'Equipment']));
    expect(operator).not.toContain('Purchasing');
  });
});
