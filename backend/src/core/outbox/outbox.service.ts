import type pg from 'pg';
import type { Logger } from 'pino';

export interface DomainEvent {
  eventType: string; // e.g. "fermentation.started"
  aggregate: string; // e.g. "FermentationBatch"
  aggregateId: string;
  payload: Record<string, unknown>;
}

export const DOMAIN_EVENTS_QUEUE = 'domain-events';

/** Anything that can enqueue a job inside a given DB transaction (pg-boss `send` with `db`). */
export interface TransactionalQueue {
  sendInTx(tx: pg.PoolClient, queue: string, data: object, opts?: { singletonKey?: string }): Promise<void>;
}

/**
 * Transactional outbox (ARCHITECTURE.md §1 principle 4, §12).
 * Services call `emit(tx, event)` in the same transaction as the business change.
 * The relay moves PENDING rows to the pg-boss "domain-events" queue; because
 * pg-boss lives in the same PostgreSQL database, the job insert and the
 * PROCESSED update commit atomically — events are never lost or duplicated.
 */
export class OutboxService {
  async emit(tx: pg.PoolClient, e: DomainEvent): Promise<string> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO outbox_events (event_type, aggregate, aggregate_id, payload) VALUES ($1, $2, $3, $4) RETURNING id`,
      [e.eventType, e.aggregate, e.aggregateId, JSON.stringify(e.payload)],
    );
    return rows[0]!.id;
  }
}

export class OutboxRelay {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly pool: pg.Pool,
    private readonly queue: TransactionalQueue,
    private readonly logger: Logger,
    private readonly opts: { intervalMs?: number; batchSize?: number; maxAttempts?: number } = {},
  ) {}

  /** Relays one batch; returns how many events were handed to the queue successfully. */
  async relayOnce(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, event_type, aggregate, aggregate_id, payload, attempts FROM outbox_events
          WHERE status = 'PENDING' ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [this.opts.batchSize ?? 50],
      );
      let relayed = 0;
      for (const r of rows) {
        await client.query('SAVEPOINT relay_one');
        try {
          await this.queue.sendInTx(client, DOMAIN_EVENTS_QUEUE, {
            outboxId: r.id, eventType: r.event_type, aggregate: r.aggregate, aggregateId: r.aggregate_id, payload: r.payload,
          }, { singletonKey: r.id });
          await client.query(`UPDATE outbox_events SET status = 'PROCESSED', processed_at = now(), attempts = attempts + 1 WHERE id = $1`, [r.id]);
          await client.query('RELEASE SAVEPOINT relay_one');
          relayed++;
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT relay_one');
          const failed = r.attempts + 1 >= (this.opts.maxAttempts ?? 10);
          await client.query(
            `UPDATE outbox_events SET attempts = attempts + 1, last_error = $2, status = $3 WHERE id = $1`,
            [r.id, String((err as Error).message).slice(0, 1000), failed ? 'FAILED' : 'PENDING'],
          );
          this.logger.error({ err, outboxId: r.id }, 'outbox relay failed for event');
        }
      }
      await client.query('COMMIT');
      return relayed;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  start(): void {
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        const batch = this.opts.batchSize ?? 50;
        while ((await this.relayOnce()) === batch) { /* full batch relayed: drain the backlog */ }
      } catch (err) {
        this.logger.error({ err }, 'outbox relay tick failed');
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(() => void tick(), this.opts.intervalMs ?? 2000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
