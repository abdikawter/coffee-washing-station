import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onSession, refreshSession, setAccessToken } from '../api/client';
import { authApi } from '../api/endpoints';
import type { Principal, Session } from '../api/types';

export interface AuthState {
  user: Principal | null;
  /** true until the initial silent refresh has finished */
  initializing: boolean;
  login: (username: string, password: string) => Promise<Principal>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<Principal>;
  can: (permission: string | string[]) => boolean;
}

export const AuthContext = createContext<AuthState | null>(null);

/** true when the user holds any of the permissions. The backend stays the authority. */
export function hasPermission(user: Principal | null, permission: string | string[]): boolean {
  if (!user) return false;
  const needed = Array.isArray(permission) ? permission : [permission];
  return needed.some((p) => user.permissions.includes(p));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Principal | null>(null);
  const [initializing, setInitializing] = useState(true);

  const apply = useCallback((s: Session | null) => {
    setAccessToken(s?.accessToken ?? null);
    setUser(s?.user ?? null);
  }, []);

  useEffect(() => {
    onSession(apply);
    // Restore the session from the httpOnly refresh cookie on page load.
    refreshSession().finally(() => setInitializing(false));
  }, [apply]);

  const login = useCallback(async (username: string, password: string) => {
    const s = await authApi.login(username, password);
    apply(s);
    return s.user;
  }, [apply]);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    apply(null);
  }, [apply]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const s = await authApi.changePassword(currentPassword, newPassword);
    apply(s);
    return s.user;
  }, [apply]);

  const value = useMemo<AuthState>(
    () => ({ user, initializing, login, logout, changePassword, can: (p) => hasPermission(user, p) }),
    [user, initializing, login, logout, changePassword],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
