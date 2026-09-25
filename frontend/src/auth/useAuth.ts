import { useContext } from 'react';
import { AuthContext, type AuthState } from './AuthContext';

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Permission-aware UI: hide or disable actions (the API re-checks every call). */
export function usePermission(permission: string | string[]): boolean {
  return useAuth().can(permission);
}
