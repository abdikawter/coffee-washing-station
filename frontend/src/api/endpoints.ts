import { http } from './client';
import type { AuditEntry, Page, Permission, Principal, Role, Session, Setting, User } from './types';

type Data<T> = { data: T };

export const authApi = {
  login: (username: string, password: string) => http.post<Data<Session>>('/auth/login', { username, password }).then((r) => r.data.data),
  logout: () => http.post('/auth/logout'),
  me: () => http.get<Data<Principal>>('/auth/me').then((r) => r.data.data),
  changePassword: (currentPassword: string, newPassword: string) =>
    http.post<Data<Session>>('/auth/change-password', { currentPassword, newPassword }).then((r) => r.data.data),
};

export interface UserQuery {
  page: number;
  pageSize: number;
  sort?: string;
  status?: string;
  role?: string;
  search?: string;
}

const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));

export const usersApi = {
  list: (q: UserQuery) => http.get<Page<User>>('/users', { params: clean(q) }).then((r) => r.data),
  create: (body: { username: string; fullName: string; email?: string | null; phone?: string | null; roleCodes: string[]; temporaryPassword: string }) =>
    http.post<Data<User>>('/users', body).then((r) => r.data.data),
  update: (id: string, body: { fullName?: string; email?: string | null; phone?: string | null }) =>
    http.patch<Data<User>>(`/users/${id}`, body).then((r) => r.data.data),
  setRoles: (id: string, roleCodes: string[], reason: string) => http.put<Data<User>>(`/users/${id}/roles`, { roleCodes, reason }).then((r) => r.data.data),
  setStatus: (id: string, action: 'deactivate' | 'activate' | 'unlock', reason: string) =>
    http.post<Data<User>>(`/users/${id}/${action}`, { reason }).then((r) => r.data.data),
  resetPassword: (id: string, temporaryPassword: string, reason: string) =>
    http.post<Data<User>>(`/users/${id}/reset-password`, { temporaryPassword, reason }).then((r) => r.data.data),
};

export const rolesApi = {
  list: () => http.get<Data<Role[]>>('/roles').then((r) => r.data.data),
  permissions: () => http.get<Data<Permission[]>>('/permissions').then((r) => r.data.data),
  setPermissions: (id: string, permissionCodes: string[], reason: string) =>
    http.put<Data<Role>>(`/roles/${id}/permissions`, { permissionCodes, reason }).then((r) => r.data.data),
};

export const settingsApi = {
  list: () => http.get<Data<Setting[]>>('/settings').then((r) => r.data.data),
  unconfirmed: () => http.get<Data<Setting[]>>('/settings/unconfirmed').then((r) => r.data.data),
  update: (key: string, body: { value?: unknown; version: number; reason: string }) =>
    http.put<Data<Setting>>(`/settings/${key}`, body).then((r) => r.data.data),
};

export interface AuditQuery {
  page: number;
  pageSize: number;
  action?: string;
  module?: string;
  entityType?: string;
  entityId?: string;
  userId?: string;
  from?: string;
  to?: string;
}

export const auditApi = {
  list: (q: AuditQuery) => http.get<Page<AuditEntry>>('/audit-logs', { params: clean(q) }).then((r) => r.data),
  verify: () =>
    http.get<Data<{ valid: boolean; checked: number; brokenAtId?: string; reason?: string }>>('/audit-logs/verify').then((r) => r.data.data),
};
