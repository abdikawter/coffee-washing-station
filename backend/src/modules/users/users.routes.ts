import { z } from 'zod';
import type { Api } from '../../http/api.js';
import { boolQuery, list, pagination, single, uuidParam } from '../../http/schemas.js';
import { ROLE_CODES } from '../access/catalog.js';
import type { RolesService } from '../access/roles.service.js';
import { DEPARTMENTS, type EmployeesService } from './employees.service.js';
import type { UsersService } from './users.service.js';

const userSchema = z
  .object({
    id: z.uuid(),
    username: z.string(),
    email: z.string().nullable(),
    fullName: z.string(),
    phone: z.string().nullable(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']),
    mustChangePassword: z.boolean(),
    lockedUntil: z.date().nullable(),
    lastLoginAt: z.date().nullable(),
    roles: z.array(z.string()),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .meta({ id: 'User' });

const roleSchema = z
  .object({
    id: z.uuid(), code: z.string(), name: z.string(), description: z.string().nullable(),
    isSystem: z.boolean(), userCount: z.number().int(), permissions: z.array(z.string()),
  })
  .meta({ id: 'Role' });

const permissionSchema = z
  .object({ id: z.uuid(), code: z.string(), module: z.string(), action: z.string(), description: z.string().nullable() })
  .meta({ id: 'Permission' });

const employeeSchema = z
  .object({
    id: z.uuid(), employeeNo: z.string(), fullName: z.string(), position: z.string(), department: z.enum(DEPARTMENTS),
    phone: z.string().nullable(), userId: z.uuid().nullable(), isActive: z.boolean(), createdAt: z.date(), updatedAt: z.date(),
  })
  .meta({ id: 'Employee' });

const username = z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/, 'letters, digits, dot, dash, underscore');
const reason = z.string().trim().min(3).max(500);
const phone = z.string().trim().min(5).max(30).nullable();
const roleCodes = z.array(z.enum(ROLE_CODES)).min(1).max(ROLE_CODES.length);

export function registerUserRoutes(api: Api, users: UsersService, roles: RolesService, employees: EmployeesService): void {
  // ---------------- Users ----------------
  api.route('Users', {
    method: 'get', path: '/users', summary: 'List users',
    access: { permission: 'user:read' },
    query: pagination(['username', 'fullName', 'createdAt', 'lastLoginAt'] as const, 'username').extend({
      status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']).optional(),
      role: z.enum(ROLE_CODES).optional(),
      search: z.string().trim().min(1).max(100).optional(),
    }).strict(),
    response: { status: 200, description: 'Page of users', schema: list(userSchema) },
    handler: async ({ query }) => {
      const r = await users.list(query);
      return { data: r.data, meta: { page: query.page, pageSize: query.pageSize, total: r.total } };
    },
  });

  api.route('Users', {
    method: 'get', path: '/users/:id', summary: 'Get a user',
    access: { permission: 'user:read' }, params: uuidParam,
    response: { status: 200, description: 'User', schema: single(userSchema) },
    handler: async ({ params }) => ({ data: await users.get(params.id) }),
  });

  api.route('Users', {
    method: 'post', path: '/users', summary: 'Create a user',
    description: 'The temporary password must be changed at first login.',
    access: { permission: 'user:manage' },
    body: z.object({
      username, fullName: z.string().trim().min(2).max(150), email: z.email().max(200).nullable().optional(),
      phone: phone.optional(), roleCodes, temporaryPassword: z.string().min(1).max(128),
    }).strict(),
    response: { status: 201, description: 'Created', schema: single(userSchema) },
    handler: async ({ body, user, meta }) => ({ data: await users.create(user, body, meta) }),
  });

  api.route('Users', {
    method: 'patch', path: '/users/:id', summary: 'Update user profile fields',
    access: { permission: 'user:manage' }, params: uuidParam,
    body: z.object({ fullName: z.string().trim().min(2).max(150).optional(), email: z.email().max(200).nullable().optional(), phone: phone.optional() })
      .strict().refine((b) => Object.keys(b).length > 0, 'nothing to update'),
    response: { status: 200, description: 'Updated', schema: single(userSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await users.update(user, params.id, body, meta) }),
  });

  api.route('Users', {
    method: 'put', path: '/users/:id/roles', summary: 'Replace a user\'s roles',
    access: { permission: 'user:manage' }, params: uuidParam,
    body: z.object({ roleCodes, reason }).strict(),
    response: { status: 200, description: 'Updated', schema: single(userSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await users.setRoles(user, params.id, body.roleCodes, body.reason, meta) }),
  });

  for (const action of ['deactivate', 'activate', 'unlock'] as const) {
    api.route('Users', {
      method: 'post', path: `/users/:id/${action}`, summary: `${action[0]!.toUpperCase()}${action.slice(1)} a user`,
      access: { permission: 'user:manage' }, params: uuidParam,
      body: z.object({ reason }).strict(),
      response: { status: 200, description: 'Updated', schema: single(userSchema) },
      handler: async ({ params, body, user, meta }) => ({ data: await users.setStatus(user, params.id, action, body.reason, meta) }),
    });
  }

  api.route('Users', {
    method: 'post', path: '/users/:id/reset-password', summary: 'Set a temporary password (forces change at next login)',
    access: { permission: 'user:manage' }, params: uuidParam,
    body: z.object({ temporaryPassword: z.string().min(1).max(128), reason }).strict(),
    response: { status: 200, description: 'Password reset', schema: single(userSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await users.resetPassword(user, params.id, body.temporaryPassword, body.reason, meta) }),
  });

  // ---------------- Roles & permissions ----------------
  api.route('Roles', {
    method: 'get', path: '/roles', summary: 'List roles with their permissions',
    access: { permission: 'role:read' },
    response: { status: 200, description: 'Roles', schema: single(z.array(roleSchema)) },
    handler: async () => ({ data: await roles.listRoles() }),
  });

  api.route('Roles', {
    method: 'get', path: '/permissions', summary: 'List all permission codes',
    access: { permission: 'role:read' },
    response: { status: 200, description: 'Permissions', schema: single(z.array(permissionSchema)) },
    handler: async () => ({ data: await roles.listPermissions() }),
  });

  api.route('Roles', {
    method: 'put', path: '/roles/:id/permissions', summary: 'Replace the permissions of a role',
    description: 'Segregation of duties still applies regardless of permissions held.',
    access: { permission: 'role:manage' }, params: uuidParam,
    body: z.object({ permissionCodes: z.array(z.string().min(3).max(64)).max(500), reason }).strict(),
    response: { status: 200, description: 'Updated role', schema: single(roleSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await roles.setRolePermissions(user, params.id, body.permissionCodes, body.reason, meta) }),
  });

  // ---------------- Employees ----------------
  const employeeBody = z.object({
    employeeNo: z.string().trim().min(1).max(30),
    fullName: z.string().trim().min(2).max(150),
    position: z.string().trim().min(2).max(100),
    department: z.enum(DEPARTMENTS),
    phone: phone.optional().default(null),
    userId: z.uuid().nullable().optional().default(null),
  }).strict();

  api.route('Employees', {
    method: 'get', path: '/employees', summary: 'List employees (permanent staff)',
    access: { permission: 'user:read' },
    query: pagination(['employeeNo', 'fullName', 'department', 'createdAt'] as const, 'employeeNo').extend({
      department: z.enum(DEPARTMENTS).optional(), active: boolQuery.optional(), search: z.string().trim().min(1).max(100).optional(),
    }).strict(),
    response: { status: 200, description: 'Page of employees', schema: list(employeeSchema) },
    handler: async ({ query }) => {
      const r = await employees.list(query);
      return { data: r.data, meta: { page: query.page, pageSize: query.pageSize, total: r.total } };
    },
  });

  api.route('Employees', {
    method: 'post', path: '/employees', summary: 'Create an employee',
    access: { permission: 'user:manage' }, body: employeeBody,
    response: { status: 201, description: 'Created', schema: single(employeeSchema) },
    handler: async ({ body, user, meta }) => ({ data: await employees.create(user, body, meta) }),
  });

  api.route('Employees', {
    method: 'patch', path: '/employees/:id', summary: 'Update an employee',
    access: { permission: 'user:manage' }, params: uuidParam,
    body: z.object({
      fullName: z.string().trim().min(2).max(150).optional(),
      position: z.string().trim().min(2).max(100).optional(),
      department: z.enum(DEPARTMENTS).optional(),
      phone: phone.optional(),
      userId: z.uuid().nullable().optional(),
      isActive: z.boolean().optional(),
    }).strict().refine((b) => Object.keys(b).length > 0, 'nothing to update'),
    response: { status: 200, description: 'Updated', schema: single(employeeSchema) },
    handler: async ({ params, body, user, meta }) => ({ data: await employees.update(user, params.id, body, meta) }),
  });
}
