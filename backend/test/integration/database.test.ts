import pg from 'pg';
import { loadMigrations, migrationStatus } from '../../src/db/migrator.js';
import { createUser } from '../helpers/app.js';

let pool: pg.Pool;
beforeAll(() => { pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 }); });
afterAll(() => pool.end());

describe('database schema (migrations on an empty database)', () => {
  it('applied every migration file', async () => {
    const files = await loadMigrations();
    const status = await migrationStatus(pool);
    expect(status.pending).toEqual([]);
    expect(status.applied.map((a) => a.version)).toEqual(files.map((f) => f.version));
  });

  it('has all 78 blueprint tables, 64 enums and the platform table', async () => {
    const t = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name NOT IN ('schema_migrations', 'idempotency_keys')`);
    expect(t.rows[0].n).toBe(78);
    const e = await pool.query(`SELECT count(*)::int AS n FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typtype = 'e' AND n.nspname = 'public'`);
    expect(e.rows[0].n).toBe(64);
  });

  it.each(['audit_logs', 'lot_events', 'inventory_transactions', 'cash_transactions'])('%s is append-only', async (table) => {
    const trig = await pool.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal ORDER BY tgname`, [table]);
    expect(trig.rows.map((r) => r.tgname)).toEqual([`t_${table}_append_only`, `t_${table}_no_truncate`]);
  });

  it('rejects UPDATE and DELETE on the audit log', async () => {
    const id = (await pool.query('SELECT id FROM audit_logs ORDER BY id LIMIT 1')).rows[0].id;
    await expect(pool.query(`UPDATE audit_logs SET module = 'x' WHERE id = $1`, [id])).rejects.toMatchObject({ code: 'P0A01' });
    await expect(pool.query(`DELETE FROM audit_logs WHERE id = $1`, [id])).rejects.toMatchObject({ code: 'P0A01' });
    await expect(pool.query(`TRUNCATE audit_logs`)).rejects.toMatchObject({ code: 'P0A01' });
  });

  it('enforces segregation of duties at database level (defence in depth)', async () => {
    const u = await createUser(pool, []);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const wh = await client.query(`INSERT INTO warehouses (code, name, type) VALUES ('W-SOD', 'W', 'PARCHMENT_STORE') RETURNING id`);
      const sec = await client.query(`INSERT INTO warehouse_sections (warehouse_id, code, name) VALUES ($1, 'S1', 'S') RETURNING id`, [wh.rows[0].id]);
      const s1 = await client.query(`INSERT INTO warehouse_stacks (section_id, code, qr_token) VALUES ($1, 'A', 'qr-a-sod') RETURNING id`, [sec.rows[0].id]);
      const s2 = await client.query(`INSERT INTO warehouse_stacks (section_id, code, qr_token) VALUES ($1, 'B', 'qr-b-sod') RETURNING id`, [sec.rows[0].id]);
      const item = await client.query(`INSERT INTO inventory_items (code, name, category, unit) VALUES ('PARCH-SOD', 'Parchment', 'PARCHMENT_COFFEE', 'kg') RETURNING id`);
      await expect(
        client.query(
          `INSERT INTO stock_transfers (transfer_no, item_id, from_stack_id, to_stack_id, quantity, requested_by_id, approved_by_id)
           VALUES ('TRF-SOD', $1, $2, $3, 10, $4, $4)`,
          [item.rows[0].id, s1.rows[0].id, s2.rows[0].id, u.id],
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'ck_transfer_sod' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('treats NULL lot/grade as equal in stock balance keys (NULLS NOT DISTINCT)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const wh = await client.query(`INSERT INTO warehouses (code, name, type) VALUES ('W-NN', 'W', 'RATION_STORE') RETURNING id`);
      const sec = await client.query(`INSERT INTO warehouse_sections (warehouse_id, code, name) VALUES ($1, 'S1', 'S') RETURNING id`, [wh.rows[0].id]);
      const st = await client.query(`INSERT INTO warehouse_stacks (section_id, code, qr_token) VALUES ($1, 'A', 'qr-nn') RETURNING id`, [sec.rows[0].id]);
      const item = await client.query(`INSERT INTO inventory_items (code, name, category, unit) VALUES ('MAIZE', 'Maize', 'RATION', 'kg') RETURNING id`);
      await client.query(`INSERT INTO stock_balances (item_id, stack_id, quantity) VALUES ($1, $2, 5)`, [item.rows[0].id, st.rows[0].id]);
      await client.query('SAVEPOINT s');
      await expect(client.query(`INSERT INTO stock_balances (item_id, stack_id, quantity) VALUES ($1, $2, 5)`, [item.rows[0].id, st.rows[0].id]))
        .rejects.toMatchObject({ code: '23505', constraint: 'ux_stock_key' });
      await client.query('ROLLBACK TO SAVEPOINT s');
      await expect(client.query(`UPDATE stock_balances SET quantity = -1 WHERE item_id = $1`, [item.rows[0].id]))
        .rejects.toMatchObject({ code: '23514', constraint: 'ck_stock_nonneg' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('keeps updated_at current', async () => {
    const u = await createUser(pool, []);
    const before = (await pool.query('SELECT updated_at FROM users WHERE id = $1', [u.id])).rows[0].updated_at as Date;
    await new Promise((r) => setTimeout(r, 20));
    await pool.query(`UPDATE users SET phone = '0911' WHERE id = $1`, [u.id]);
    const after = (await pool.query('SELECT updated_at FROM users WHERE id = $1', [u.id])).rows[0].updated_at as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it('returns business dates as strings and decimals as strings', async () => {
    const r = await pool.query(`SELECT DATE '2026-09-25' AS d, 12.345::numeric(12,3) AS kg`);
    expect(r.rows[0]).toEqual({ d: '2026-09-25', kg: '12.345' });
  });
});
