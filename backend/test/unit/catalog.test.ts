import { PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS, ROLES } from '../../src/modules/access/catalog.js';

const has = (role: keyof typeof ROLE_PERMISSIONS, perm: string) => ROLE_PERMISSIONS[role].includes(perm);

describe('permission catalog (ARCHITECTURE.md §7)', () => {
  it('defines all 11 roles', () => {
    expect(Object.keys(ROLES).sort()).toEqual([...ROLE_CODES].sort());
    expect(ROLE_CODES).toHaveLength(11);
  });

  it('only grants permissions that exist, without duplicates', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      for (const p of perms) expect({ role, p, exists: p in PERMISSIONS }).toEqual({ role, p, exists: true });
      expect(new Set(perms).size).toBe(perms.length);
    }
  });

  it('uses module:action codes', () => {
    for (const code of Object.keys(PERMISSIONS)) expect(code).toMatch(/^[a-z]+:[a-z-]+$/);
  });

  it('every permission is granted to at least one role', () => {
    const granted = new Set(Object.values(ROLE_PERMISSIONS).flat());
    expect(Object.keys(PERMISSIONS).filter((p) => !granted.has(p))).toEqual([]);
  });

  it.each([
    // [role, permission, expected] — spot checks of matrix cells
    ['SUPER_ADMIN', 'user:manage', true],
    ['SUPER_ADMIN', 'purchase:approve', false], // SA reads purchases only
    ['SUPER_ADMIN', 'payment:disburse', false],
    ['SUPER_ADMIN', 'report:export', false], // "R" only
    ['SITE_MANAGER', 'purchase:approve', true],
    ['SITE_MANAGER', 'purchase:void', true],
    ['SITE_MANAGER', 'settings:manage', true],
    ['SITE_MANAGER', 'settings:manage-system', false],
    ['SITE_MANAGER', 'audit:read-unannounced', false], // "R (not unannounced schedule)"
    ['SITE_MANAGER', 'srv:approve', true],
    ['QUALITY_INSPECTOR', 'purchase:verify', true],
    ['QUALITY_INSPECTOR', 'purchase:approve', false],
    ['QUALITY_INSPECTOR', 'quality:hold-release', true],
    ['QUALITY_INSPECTOR', 'drying:final-verify', true],
    ['PURCHASING_CLERK', 'purchase:create', true],
    ['PURCHASING_CLERK', 'payment:create', false],
    ['PURCHASING_CLERK', 'scale:verify', true],
    ['CASHIER_ACCOUNTANT', 'payment:disburse', true],
    ['CASHIER_ACCOUNTANT', 'payment:approve', false],
    ['CASHIER_ACCOUNTANT', 'payroll:approve-cashier', true],
    ['PULPING_OPERATOR', 'reconciliation:run', true],
    ['PULPING_OPERATOR', 'reconciliation:review', false],
    ['DRYING_SUPERVISOR', 'srv:deliver', true],
    ['DRYING_SUPERVISOR', 'srv:receive', false],
    ['DRYING_SUPERVISOR', 'payroll:prepare', true],
    ['STOREKEEPER', 'srv:receive', true],
    ['STOREKEEPER', 'inventory:adjust', true],
    ['STOREKEEPER', 'inventory:adjust-approve', false],
    ['CAPITA', 'attendance:record-own-group', true],
    ['CAPITA', 'attendance:read', false],
    ['CAPITA', 'lot:lookup', true],
    ['TEMP_WORKER', 'payroll:read-self', true],
    ['TEMP_WORKER', 'settings:read', false],
    ['AUDITOR', 'ca:verify', true],
    ['AUDITOR', 'audit:manage', true],
    ['AUDITOR', 'purchase:create', false],
  ] as const)('%s has %s = %s', (role, perm, expected) => {
    expect(has(role, perm)).toBe(expected);
  });

  it('never gives one role both halves of the purchase controlled pairs', () => {
    for (const role of ROLE_CODES) {
      expect(has(role, 'purchase:create') && has(role, 'purchase:approve')).toBe(false);
      expect(has(role, 'payment:create') && has(role, 'payment:approve')).toBe(false);
      expect(has(role, 'srv:deliver') && has(role, 'srv:receive')).toBe(false);
    }
  });

  it('AUDITOR is read-only outside audits and corrective actions', () => {
    const writes = ROLE_PERMISSIONS.AUDITOR.filter(
      (p) => !/:([a-z]+-)?read(-[a-z]+)?$/.test(p) && !p.startsWith('report:') && !['audit:manage', 'ca:create', 'ca:verify', 'file:upload', 'file:read'].includes(p),
    );
    expect(writes).toEqual([]);
  });
});
