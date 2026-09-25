import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loading } from '../components/common';
import { useAuth } from '../auth/useAuth';
import { ForbiddenPage } from '../pages/ErrorPages';

/** Signed-in users only; users who must change their password are sent to that page first. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, initializing } = useAuth();
  const location = useLocation();
  if (initializing) return <Loading label="Restoring session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  return <>{children}</>;
}

/** Route-level permission gate (any-of). */
export function RequirePermission({ permission, children }: { permission?: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (permission && !can(permission)) return <ForbiddenPage />;
  return <>{children}</>;
}
