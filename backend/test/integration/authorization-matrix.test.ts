/**
 * Generated authorization test (ARCHITECTURE.md §15): reads every registered
 * route's access rule and the seeded role → permission data, then calls every
 * endpoint as every role. A role lacking the permission must get 403 FORBIDDEN;
 * a role holding it must never get 401/403 (it may get 400/404 for the dummy input).
 */
import request from 'supertest';
import { ROLE_CODES } from '../../src/modules/access/catalog.js';
import type { RouteRecord } from '../../src/http/types.js';
import { bearer, createRole, createTestApp, tokenFor, type TestContext } from '../helpers/app.js';

let ctx: TestContext;
const tokens = new Map<string, string>();
const rolePerms = new Map<string, Set<string>>();
/** The catalog roles (SUPER_ADMIN only for now) plus two test roles so every route is also checked for denial. */
const matrixRoles: string[] = [];

beforeAll(async () => {
  ctx = await createTestApp();
  const { rows: readPerms } = await ctx.pool.query(`SELECT code FROM permissions WHERE code LIKE '%:read'`);
  matrixRoles.push(...ROLE_CODES, await createRole(ctx.pool, []), await createRole(ctx.pool, readPerms.map((r) => r.code)));
  for (const role of matrixRoles) tokens.set(role, (await tokenFor(ctx, [role])).token);
  const { rows } = await ctx.pool.query(
    `SELECT r.code, COALESCE(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS perms
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id GROUP BY r.code`,
  );
  for (const r of rows) rolePerms.set(r.code, new Set(r.perms));
}, 60_000);
afterAll(() => ctx.close());

const DUMMY_ID = '00000000-0000-4000-8000-00000000abcd';
function concrete(path: string): string {
  return path.replace(':id', DUMMY_ID).replace(':key', 'ops.maxBackdateHours');
}
function call(r: RouteRecord, token?: string) {
  const req = request(ctx.app)[r.method](concrete(r.path));
  if (token) req.set(bearer(token));
  return r.method === 'get' || r.method === 'delete' ? req : req.send({});
}

const EXPECTED_PUBLIC = ['GET /api/v1/health/live', 'GET /api/v1/health/ready', 'POST /api/v1/auth/login', 'POST /api/v1/auth/logout', 'POST /api/v1/auth/refresh'];

describe('route guard (deny by default)', () => {
  it('exposes exactly the intended public routes', async () => {
    const t = await createTestApp();
    const pub = t.api.routes.filter((r) => 'public' in r.access).map((r) => `${r.method.toUpperCase()} ${r.path}`).sort();
    await t.close();
    expect(pub).toEqual(EXPECTED_PUBLIC);
  });

  it('every permission a route requires exists in the permissions table', async () => {
    const { rows } = await ctx.pool.query('SELECT code FROM permissions');
    const known = new Set(rows.map((r) => r.code));
    for (const r of ctx.api.routes) {
      if (!('permission' in r.access)) continue;
      for (const p of [r.access.permission].flat()) expect({ route: r.path, p, known: known.has(p) }).toEqual({ route: r.path, p, known: true });
    }
  });

  it('every non-public route answers 401 without a token', async () => {
    for (const r of ctx.api.routes.filter((x) => !('public' in x.access))) {
      const res = await call(r);
      expect({ route: `${r.method} ${r.path}`, status: res.status }).toEqual({ route: `${r.method} ${r.path}`, status: 401 });
    }
  });
});

describe('role × route matrix', () => {
  it('grants and denies exactly per role_permissions', async () => {
    const mismatches: string[] = [];
    let checked = 0;
    for (const r of ctx.api.routes.filter((x) => !('public' in x.access))) {
      for (const role of matrixRoles) {
        const perms = rolePerms.get(role)!;
        const allowed = 'authenticated' in r.access || [(r.access as { permission: string | string[] }).permission].flat().some((p) => perms.has(p));
        const res = await call(r, tokens.get(role));
        checked++;
        const denied = res.status === 403 && res.body.code === 'FORBIDDEN';
        const unauthenticated = res.status === 401;
        if (allowed && (denied || unauthenticated)) mismatches.push(`${role} should reach ${r.method.toUpperCase()} ${r.path} but got ${res.status} ${res.body.code}`);
        if (!allowed && !denied) mismatches.push(`${role} should be denied ${r.method.toUpperCase()} ${r.path} but got ${res.status} ${res.body?.code}`);
      }
    }
    expect(mismatches).toEqual([]);
    expect(checked).toBeGreaterThan(200);
  }, 120_000);
});
