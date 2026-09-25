/** API types (mirror the backend OpenAPI schemas; decimals are strings). */
export interface Principal {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  mustChangePassword: boolean;
  roles: string[];
  permissions: string[];
}

export interface Session {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: Principal;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}
export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'LOCKED';
export interface User {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  phone: string | null;
  status: UserStatus;
  mustChangePassword: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  roles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissions: string[];
}

export interface Permission {
  id: string;
  code: string;
  module: string;
  action: string;
  description: string | null;
}

export type SettingSource = 'MANUAL' | 'PROVISIONAL' | 'UNSET' | 'CONFIRMED';
export interface Setting {
  key: string;
  category: string;
  value: unknown;
  valueType: 'NUMBER' | 'STRING' | 'BOOLEAN' | 'ENUM' | 'JSON';
  description: string;
  source: SettingSource;
  options: string[] | null;
  isSystem: boolean;
  version: number;
  updatedById: string | null;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  userId: string | null;
  username: string | null;
  action: string;
  module: string;
  entityType: string;
  entityId: string | null;
  previousValue: unknown;
  newValue: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  hash: string;
  createdAt: string;
}

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  code: string;
  message: string;
  details?: unknown;
  requestId: string | null;
}
