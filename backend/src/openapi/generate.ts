/** Writes openapi.json without a database (routes are registered, never called). Used by the frontend type generator. */
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { createContainer } from '../container.js';
import { createLogger } from '../logger.js';

const env = loadEnv({
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://unused/unused',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'openapi-generation-only-secret-0000000000',
});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const { openApi } = createApp(createContainer(env, pool, createLogger(env)));
const out = process.argv[2] ?? 'openapi.json';
writeFileSync(out, JSON.stringify(openApi, null, 2));
console.log(`wrote ${out}`);
void pool.end();
