import type { ReactNode } from 'react';
import { usePermission } from './useAuth';

/** Renders children only when the user holds one of the permissions. */
export function Can({ permission, children, fallback = null }: { permission: string | string[]; children: ReactNode; fallback?: ReactNode }) {
  return <>{usePermission(permission) ? children : fallback}</>;
}
