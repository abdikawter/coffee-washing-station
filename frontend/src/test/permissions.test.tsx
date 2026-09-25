import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Principal } from '../api/types';
import { AuthContext, hasPermission, type AuthState } from '../auth/AuthContext';
import { Can } from '../auth/Can';
import { visibleNav } from '../navigation';
import { RequirePermission } from '../routes/guards';

const principal = (permissions: string[], roles: string[] = []): Principal => ({
  id: '1', username: 'u', fullName: 'Test User', email: null, mustChangePassword: false, roles, permissions,
});

function withAuth(user: Principal | null, ui: React.ReactNode) {
  const value: AuthState = {
    user, initializing: false, login: vi.fn(), logout: vi.fn(), changePassword: vi.fn(), can: (p) => hasPermission(user, p),
  };
  return render(<MemoryRouter><AuthContext.Provider value={value}>{ui}</AuthContext.Provider></MemoryRouter>);
}

describe('permission-aware UI', () => {
  it('hasPermission is any-of and false without a user', () => {
    expect(hasPermission(principal(['a:b']), ['x:y', 'a:b'])).toBe(true);
    expect(hasPermission(principal(['a:b']), 'x:y')).toBe(false);
    expect(hasPermission(null, 'a:b')).toBe(false);
  });

  it('<Can> hides actions the user may not perform', () => {
    withAuth(principal(['user:read']), <><Can permission="user:manage"><button>New user</button></Can><Can permission="user:read"><span>list</span></Can></>);
    expect(screen.queryByText('New user')).not.toBeInTheDocument();
    expect(screen.getByText('list')).toBeInTheDocument();
  });

  it('<RequirePermission> shows the no-access page', () => {
    withAuth(principal([]), <RequirePermission permission={['auditlog:read']}><span>secret</span></RequirePermission>);
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.getByText('No access')).toBeInTheDocument();
  });

  it('navigation follows the role matrix', () => {
    const labels = (perms: string[]) => visibleNav(principal(perms)).map((i) => i.label);
    // TEMP_WORKER: only own workforce data
    expect(labels(['worker:read-self', 'attendance:read-self', 'payroll:read-self'])).toEqual(['Dashboard', 'Workers & payroll']);
    // CAPITA sees lots via lookup and rations via own-group request
    expect(labels(['lot:lookup', 'drying:read', 'siv:request-own-group', 'worker:read-own-group'])).toEqual(
      expect.arrayContaining(['Lots & traceability', 'Drying', 'Rations & issues', 'Workers & payroll']),
    );
    expect(labels(['lot:lookup'])).not.toContain('Users');
    expect(labels(['user:read', 'role:read', 'settings:read', 'auditlog:read'])).toEqual(
      expect.arrayContaining(['Users', 'Roles', 'Settings', 'Audit log']),
    );
  });
});
