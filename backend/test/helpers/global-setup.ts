import pg from 'pg';
import { migrate } from '../../src/db/migrator.js';
import { seed } from '../../src/db/seed-lib.js';

import { TEST_ADMIN_PASSWORD } from './constants.js';

/**
 * Recreates the test database from scratch, applies every migration and seeds it.
 * This is also the "migrations apply on an empty database" check of the phase gate.
 */
export async function prepareTestDatabase(): Promise<void> {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/cws_test');
  const dbName = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  try {
    await migrate(pool);
    await seed(pool, { username: 'admin', fullName: 'Test Admin', password: TEST_ADMIN_PASSWORD });
  } finally {
    await pool.end();
  }
}

// Executed via `tsx` from global-setup.cjs (Jest's globalSetup bypasses the ESM module mapper).
if (process.argv[1]?.endsWith('global-setup.ts')) {
  prepareTestDatabase().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
