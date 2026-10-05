import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Principal } from '../api/types';
import { AuthContext, hasPermission, type AuthState } from '../auth/AuthContext';
import { ColorModeProvider } from '../theme';

const user = (permissions: string[]): Principal => ({
  id: 'u1', username: 'u', fullName: 'Test User', email: null, mustChangePassword: false, roles: [], permissions,
});

/** Shows the current URL so tests can assert what FilterBar / DataTable wrote. */
function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname}{l.search}</output>;
}

/** Test render helper: router (at `url`), a signed-in user with `permissions`, and the app theme. */
export function setup(ui: ReactNode, { permissions = [] as string[], url = '/' } = {}) {
  const u = user(permissions);
  const auth: AuthState = { user: u, initializing: false, login: vi.fn(), logout: vi.fn(), changePassword: vi.fn(), can: (p) => hasPermission(u, p) };
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AuthContext.Provider value={auth}>
        <ColorModeProvider>
          <Routes><Route path="*" element={<>{ui}<Where /></>} /></Routes>
        </ColorModeProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}
/** The current path + query string (rendered by `Where`). */
export const where = () => screen.getByTestId('where').textContent;

