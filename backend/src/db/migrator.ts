import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

/** backend/db/migrations — same relative location from src/db and dist/db. */
export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url));

const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
// Arbitrary constant: serialises concurrent migrators (e.g. two Render instances starting).
const MIGRATION_LOCK_ID = 7_310_442_901;

export interface MigrationFile {
  version: string;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

export interface MigrationStatus {
  applied: { version: string; name: string; appliedAt: Date }[];
  pending: MigrationFile[];
}

export async function loadMigrations(dir = DEFAULT_MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const out: MigrationFile[] = [];
  for (const file of files) {
    const m = FILE_RE.exec(file);
    if (!m) throw new Error(`Migration file name must look like 0001_name.sql: ${file}`);
    const sql = await readFile(path.join(dir, file), 'utf8');
    out.push({ version: m[1]!, name: m[2]!, file, sql, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  const versions = new Set<string>();
  for (const m of out) {
    if (versions.has(m.version)) throw new Error(`Duplicate migration version ${m.version}`);
    versions.add(m.version);
  }
  return out;
}

async function ensureTable(client: pg.PoolClient | pg.Pool): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      name       text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

export async function migrationStatus(pool: pg.Pool, dir = DEFAULT_MIGRATIONS_DIR): Promise<MigrationStatus> {
  const files = await loadMigrations(dir);
  const exists = await pool.query(`SELECT to_regclass('public.schema_migrations') AS t`);
  if (!exists.rows[0].t) return { applied: [], pending: files };
  const { rows } = await pool.query(`SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version`);
  const applied = new Map(rows.map((r) => [r.version as string, r]));
  for (const f of files) {
    const a = applied.get(f.version);
    if (a && a.checksum !== f.checksum) {
      throw new Error(`Migration ${f.file} was modified after it was applied (checksum mismatch). Add a new migration instead.`);
    }
  }
  return {
    applied: rows.map((r) => ({ version: r.version, name: r.name, appliedAt: r.applied_at })),
    pending: files.filter((f) => !applied.has(f.version)),
  };
}

/**
 * Applies pending migrations in order, each in its own transaction, under an
 * advisory lock. Applied files are immutable (checksum verified).
 */
export async function migrate(
  pool: pg.Pool,
  opts: { dir?: string; log?: (msg: string) => void } = {},
): Promise<string[]> {
  const log = opts.log ?? (() => undefined);
  const client = await pool.connect();
  const appliedNow: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await ensureTable(client);
    const { pending } = await migrationStatus(pool, opts.dir);
    for (const m of pending) {
      log(`applying ${m.file}`);
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          m.version,
          m.name,
          m.checksum,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${m.file} failed: ${(err as Error).message}`, { cause: err });
      }
      appliedNow.push(m.file);
    }
    return appliedNow;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
