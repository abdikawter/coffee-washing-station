import type { Container } from '../container.js';
import { OutboxRelay } from '../core/outbox/outbox.service.js';
import { JobQueue, QUEUES } from '../core/queue/queue.js';

export interface DomainEventJob {
  outboxId: string;
  eventType: string;
  aggregate: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/**
 * Background worker (ARCHITECTURE.md §12): outbox relay + pg-boss handlers and
 * schedules. Runs inside the web process (RUN_WORKER_IN_PROCESS=true, one Render
 * Web Service) or as its own process (`npm run start:worker`, Render Background Worker).
 *
 * Phase 1: the relay, the domain-events consumer (logs; notification rules land
 * in Phase 7) and the nightly housekeeping job. Scanners (fermentation, raking,
 * calibration, maintenance, CA overdue, reconciliation, digest, integrity) are
 * added to QUEUES and scheduled here in their phases.
 */
export async function startWorker(c: Container): Promise<{ stop: () => Promise<void> }> {
  const queue = new JobQueue(c.env.DATABASE_URL, c.env.DATABASE_SSL, c.logger);
  await queue.start();
  const relay = new OutboxRelay(c.pool, queue, c.logger);
  relay.start();

  await queue.boss.work<DomainEventJob>(QUEUES.DOMAIN_EVENTS, { batchSize: 10 }, async (jobs) => {
    for (const job of jobs) {
      c.logger.info({ event: job.data.eventType, aggregate: job.data.aggregate, aggregateId: job.data.aggregateId }, 'domain event');
    }
  });

  await queue.boss.work(QUEUES.MAINTENANCE_PURGE, async () => {
    const tokens = await c.auth.purgeExpiredTokens();
    const idem = await c.pool.query('DELETE FROM idempotency_keys WHERE expires_at < now()');
    c.logger.info({ tokens, idempotencyKeys: idem.rowCount }, 'housekeeping purge done');
  });

  const tz = await c.settings.get<string>('station.timezone');
  await queue.boss.schedule(QUEUES.MAINTENANCE_PURGE, '15 2 * * *', null, { tz });

  c.logger.info('worker started');
  return {
    stop: async () => {
      relay.stop();
      await queue.stop();
    },
  };
}
