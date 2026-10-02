import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import pg from 'pg';
import request from 'supertest';
import { createApp, type AppOptions } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { createContainer, type Container } from '../../src/container.js';
import { LocalStorageAdapter } from '../../src/core/storage/storage.js';
import type { Api } from '../../src/http/api.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { createLogger } from '../../src/logger.js';

export interface TestContext {
  app: Express;
  api: Api;
  c: Container;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export async function createTestApp(opts: AppOptions = {}): Promise<TestContext> {
  const env = loadEnv();
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
  const logger = createLogger(env);
  const storage = new LocalStorageAdapter(mkdtempSync(path.join(os.tmpdir(), 'cws-files-')));
  const c = createContainer(env, pool, logger, storage);
  const { app, api } = createApp(c, opts);
  return { app, api, c, pool, close: () => pool.end() };
}

let counter = 0;
export function uniqueName(prefix = 'user'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}${Math.floor(Math.random() * 1000)}`;
}

const hashCache = new Map<string, Promise<string>>();
function cachedHash(pw: string): Promise<string> {
  if (!hashCache.has(pw)) hashCache.set(pw, hashPassword(pw));
  return hashCache.get(pw)!;
}

export const DEFAULT_PASSWORD = 'Password12345';

/**
 * Creates a role that holds exactly `permissions` and returns its code. The
 * catalog only has SUPER_ADMIN (every permission), so tests use these roles to
 * check what a user WITHOUT a permission gets.
 */
export async function createRole(pool: pg.Pool, permissions: string[]): Promise<string> {
  const code = `TEST_${uniqueName('R').toUpperCase()}`;
  const { rows } = await pool.query(`INSERT INTO roles (code, name, is_system) VALUES ($1, $1, false) RETURNING id`, [code]);
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = ANY($2)`,
    [rows[0].id, permissions],
  );
  return code;
}

/** Inserts a user directly (fast path for tests). */
export async function createUser(
  pool: pg.Pool,
  roles: string[],
  opts: { password?: string; mustChangePassword?: boolean; username?: string } = {},
): Promise<{ id: string; username: string; password: string }> {
  const username = opts.username ?? uniqueName();
  const password = opts.password ?? DEFAULT_PASSWORD;
  const { rows } = await pool.query(
    `INSERT INTO users (username, full_name, password_hash, must_change_password) VALUES ($1, $2, $3, $4) RETURNING id`,
    [username, `Test ${username}`, await cachedHash(password), opts.mustChangePassword ?? false],
  );
  for (const role of roles) {
    await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2`, [rows[0].id, role]);
  }
  return { id: rows[0].id, username, password };
}

export async function login(app: Express, username: string, password: string): Promise<{ token: string; cookie: string; body: { data: { accessToken: string; user: { mustChangePassword: boolean; roles: string[]; permissions: string[] } } } }> {
  const res = await request(app).post('/api/v1/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  const setCookie = res.headers['set-cookie'] as unknown as string[];
  return { token: res.body.data.accessToken, cookie: setCookie.map((c) => c.split(';')[0]).join('; '), body: res.body };
}

/** Creates a user with the given roles and returns a bearer token. */
export async function tokenFor(ctx: TestContext, roles: string[]): Promise<{ token: string; userId: string; username: string }> {
  const u = await createUser(ctx.pool, roles);
  const { token } = await login(ctx.app, u.username, u.password);
  return { token, userId: u.id, username: u.username };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
