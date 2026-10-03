import pg from 'pg';
import request from 'supertest';
import { z } from 'zod';
import { withTransaction } from '../../src/db/pool.js';
import { OutboxRelay, type TransactionalQueue } from '../../src/core/outbox/outbox.service.js';
import { JobQueue } from '../../src/core/queue/queue.js';
import { bearer, createTestApp, tokenFor, type TestContext } from '../helpers/app.js';

let ctx: TestContext;
let calls = 0;
beforeAll(async () => {
  ctx = await createTestApp({
    extraRoutes: (api) =>
      api.route('Test', {
        method: 'post', path: '/__test/pay', summary: 'probe', access: { authenticated: true }, idempotent: true,
        body: z.object({ amount: z.string() }).strict(),
        response: { status: 201, description: 'ok', schema: z.object({ data: z.object({ n: z.number(), amount: z.string() }) }) },
        handler: async ({ body }) => {
          calls += 1;
          if (body.amount === 'fail') throw Object.assign(new Error('boom'), {});
          return { data: { n: calls, amount: body.amount } };
        },
      }),
  });
});
afterAll(() => ctx.close());

describe('idempotency keys', () => {
  it('replays the first response for the same key and body', async () => {
    const u = await tokenFor(ctx, []);
    const first = await request(ctx.app).post('/api/v1/__test/pay').set(bearer(u.token)).set('Idempotency-Key', 'key-00000001').send({ amount: '10.00' });
    const second = await request(ctx.app).post('/api/v1/__test/pay').set(bearer(u.token)).set('Idempotency-Key', 'key-00000001').send({ amount: '10.00' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    const third = await request(ctx.app).post('/api/v1/__test/pay').set(bearer(u.token)).set('Idempotency-Key', 'key-00000002').send({ amount: '10.00' });
    expect(third.body.data.n).toBe(first.body.data.n + 1);
  });

  it('rejects reuse of a key with a different body', async () => {
    const u = await tokenFor(ctx, []);
    await request(ctx.app).post('/api/v1/__test/pay').set(bearer(u.token)).set('Idempotency-Key', 'key-reuse-1').send({ amount: '1' });
    const res = await request(ctx.app).post('/api/v1/__test/pay').set(bearer(u.token)).set('Idempotency-Key', 'key-reuse-1').send({ amount: '2' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('does not store failures, so the client can retry', async () => {
    const u = await tokenFor(ctx, []);
    const fail = await request(ctx.app).post('/api/v1/__test/pay').set(bearer(u.token)).set('Idempotency-Key', 'key-fail-01').send({ amount: 'fail' });
    expect(fail.status).toBe(500);
    const rows = await ctx.pool.query(`SELECT count(*)::int AS n FROM idempotency_keys WHERE key = 'key-fail-01'`);
    expect(rows.rows[0].n).toBe(0);
  });

  it('keys are per user', async () => {
    const a = await tokenFor(ctx, []);
    const b = await tokenFor(ctx, []);
    const ra = await request(ctx.app).post('/api/v1/__test/pay').set(bearer(a.token)).set('Idempotency-Key', 'shared-key-1').send({ amount: '5' });
    const rb = await request(ctx.app).post('/api/v1/__test/pay').set(bearer(b.token)).set('Idempotency-Key', 'shared-key-1').send({ amount: '5' });
    expect(rb.body.data.n).not.toBe(ra.body.data.n);
  });
});

describe('document sequences', () => {
  it('never hands out the same number under concurrency', async () => {
    const numbers = await Promise.all(Array.from({ length: 25 }, () => withTransaction(ctx.pool, (tx) => ctx.c.sequences.next(tx, 'PV'))));
    expect(new Set(numbers).size).toBe(25);
    for (const n of numbers) expect(n).toMatch(/^PV-\d{4}-\d{6}$/);
  });

  it('releases the number when the transaction rolls back (gap-tolerant, no duplicates)', async () => {
    const a = await withTransaction(ctx.pool, (tx) => ctx.c.sequences.next(tx, 'CA'));
    await expect(withTransaction(ctx.pool, async (tx) => { await ctx.c.sequences.next(tx, 'CA'); throw new Error('rollback'); })).rejects.toThrow();
    const b = await withTransaction(ctx.pool, (tx) => ctx.c.sequences.next(tx, 'CA'));
    expect(Number(b.slice(-5))).toBe(Number(a.slice(-5)) + 1);
  });
});

describe('transactional outbox → pg-boss', () => {
  const aggregateId = '00000000-0000-4000-8000-000000000001';

  it('drops events of rolled-back transactions', async () => {
    await expect(
      withTransaction(ctx.pool, async (tx) => {
        await ctx.c.outbox.emit(tx, { eventType: 'test.rolled-back', aggregate: 'Probe', aggregateId, payload: {} });
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow();
    const r = await ctx.pool.query(`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'test.rolled-back'`);
    expect(r.rows[0].n).toBe(0);
  });

  it('relays committed events exactly once and marks them processed', async () => {
    const id = await withTransaction(ctx.pool, (tx) => ctx.c.outbox.emit(tx, { eventType: 'test.committed', aggregate: 'Probe', aggregateId, payload: { x: 1 } }));
    const sent: string[] = [];
    const fake: TransactionalQueue = { sendInTx: async (_tx, _q, data) => { sent.push((data as { outboxId: string }).outboxId); } };
    const relay = new OutboxRelay(ctx.pool, fake, ctx.c.logger);
    // Drain: other test files leave PENDING events, and the relay takes the oldest first.
    while ((await relay.relayOnce()) > 0) { /* next batch */ }
    await relay.relayOnce();
    expect(sent.filter((s) => s === id)).toHaveLength(1);
    const row = await ctx.pool.query('SELECT status, processed_at FROM outbox_events WHERE id = $1', [id]);
    expect(row.rows[0].status).toBe('PROCESSED');
  });

  it('keeps an event PENDING with the error when the queue fails', async () => {
    const id = await withTransaction(ctx.pool, (tx) => ctx.c.outbox.emit(tx, { eventType: 'test.failing', aggregate: 'Probe', aggregateId, payload: {} }));
    const failing: TransactionalQueue = { sendInTx: async () => { throw new Error('queue down'); } };
    await new OutboxRelay(ctx.pool, failing, ctx.c.logger).relayOnce();
    const row = await ctx.pool.query('SELECT status, attempts, last_error FROM outbox_events WHERE id = $1', [id]);
    expect(row.rows[0]).toMatchObject({ status: 'PENDING', attempts: 1, last_error: 'queue down' });
    await ctx.pool.query(`UPDATE outbox_events SET status = 'FAILED' WHERE id = $1`, [id]); // keep later tests clean
  });

  it('enqueues into the real pg-boss queue inside the relay transaction', async () => {
    const queue = new JobQueue(process.env.DATABASE_URL!, false, ctx.c.logger);
    await queue.start();
    try {
      const id = await withTransaction(ctx.pool, (tx) => ctx.c.outbox.emit(tx, { eventType: 'test.pgboss', aggregate: 'Probe', aggregateId, payload: {} }));
      const relay = new OutboxRelay(ctx.pool, queue, ctx.c.logger);
      while ((await relay.relayOnce()) > 0) { /* drain older events too */ }
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
      const jobs = await pool.query(`SELECT data FROM pgboss.job WHERE name = 'domain-events' AND data->>'outboxId' = $1`, [id]);
      await pool.end();
      expect(jobs.rows).toHaveLength(1);
      expect(jobs.rows[0].data).toMatchObject({ eventType: 'test.pgboss', aggregate: 'Probe' });
    } finally {
      await queue.stop();
    }
  });
});
