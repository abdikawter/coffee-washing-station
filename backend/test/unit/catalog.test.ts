import { PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS, ROLES } from '../../src/modules/access/catalog.js';

describe('permission catalog (single SUPER_ADMIN for now)', () => {
  it('defines only the SUPER_ADMIN role', () => {
    expect(ROLE_CODES).toEqual(['SUPER_ADMIN']);
    expect(Object.keys(ROLES)).toEqual(['SUPER_ADMIN']);
  });

  it('gives SUPER_ADMIN every permission, without duplicates', () => {
    expect([...ROLE_PERMISSIONS.SUPER_ADMIN].sort()).toEqual(Object.keys(PERMISSIONS).sort());
    expect(new Set(ROLE_PERMISSIONS.SUPER_ADMIN).size).toBe(ROLE_PERMISSIONS.SUPER_ADMIN.length);
  });

  it('uses module:action codes', () => {
    for (const code of Object.keys(PERMISSIONS)) expect(code).toMatch(/^[a-z]+:[a-z-]+$/);
  });

  it.each(['user:manage', 'purchase:create', 'purchase:verify', 'purchase:approve', 'payment:disburse', 'settings:manage-system', 'report:export'])(
    'SUPER_ADMIN has %s',
    (perm) => expect(ROLE_PERMISSIONS.SUPER_ADMIN).toContain(perm),
  );
});
