import pg from 'pg';

// Business dates (DATE, oid 1082) stay "YYYY-MM-DD" strings: never shift them through JS Date/timezones.
pg.types.setTypeParser(1082, (v: string) => v);
// NUMERIC (1700) is already returned as string by pg: decimals travel as strings end to end.
// BIGINT (20) is returned as string by default: audit_logs.id stays a string in JSON.

export type Queryable = pg.Pool | pg.PoolClient;

export interface DbOptions {
  connectionString: string;
  ssl?: boolean;
  max?: number;
  applicationName?: string;
}

export function createPool(opts: DbOptions): pg.Pool {
  return new pg.Pool({
    connectionString: opts.connectionString,
    ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
    max: opts.max ?? 10,
    application_name: opts.applicationName ?? 'cws-api',
    idleTimeoutMillis: 30_000,
  });
}

export type IsolationLevel = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

/**
 * Runs fn inside a transaction on a dedicated client. Every service method that
 * changes data goes through this so that the business change, its audit row,
 * its lot/ledger entries and its outbox event commit or roll back together.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
  opts: { isolationLevel?: IsolationLevel } = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${opts.isolationLevel ?? 'READ COMMITTED'}`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** snake_case row -> camelCase object (shallow). */
export function camelize<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out as T;
}

export function camelizeRows<T = Record<string, unknown>>(rows: Record<string, unknown>[]): T[] {
  return rows.map((r) => camelize<T>(r));
}
