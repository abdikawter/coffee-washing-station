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

  // Phase 2: scales in service without a valid daily verification. Notifications arrive
  // with Phase 7; until then the job flags them in the log (weighing is still gated by
  // scale.unverifiedPolicy at voucher creation).
  await queue.boss.work(QUEUES.CALIBRATION_DUE, async () => {
    const due = await c.scales.dueForVerification();
    if (due.length) c.logger.warn({ scales: due }, 'scales need verification');
  });

  // Phase 3 monitors. Notifications arrive with Phase 7; until then they log.
  await queue.boss.work(QUEUES.FERMENTATION_MONITOR, async () => {
    const late = await c.processing.fermentation.monitor();
    if (late.length) c.logger.warn({ batches: late }, 'fermentation batches approaching or past their maximum');
  });
  await queue.boss.work(QUEUES.HOPPER_RECONCILIATION, async () => {
    const r = await c.processing.hopper.run(null, undefined).catch((err: Error & { code?: string }) => {
      if (err.code === 'RECONCILIATION_REVIEWED') return null; // already reviewed today: nothing to do
      throw err;
    });
    if (r) c.logger.info({ date: r.reconDate, status: r.status }, 'hopper reconciliation done');
  });
  await queue.boss.work(QUEUES.MAINTENANCE_DUE, async () => {
    const { rows } = await c.pool.query(
      `SELECT e.code, ms.type, ms.next_due_at FROM maintenance_schedules ms JOIN equipment e ON e.id = ms.equipment_id
        WHERE ms.is_active AND ms.next_due_at < now() AND e.status <> 'DECOMMISSIONED' ORDER BY ms.next_due_at`,
    );
    if (rows.length) c.logger.warn({ due: rows }, 'maintenance overdue');
  });

  const tz = await c.settings.get<string>('station.timezone');
  await queue.boss.schedule(QUEUES.MAINTENANCE_PURGE, '15 2 * * *', null, { tz });
  await queue.boss.schedule(QUEUES.CALIBRATION_DUE, '0 * * * *', null, { tz });
  await queue.boss.schedule(QUEUES.FERMENTATION_MONITOR, '*/5 * * * *', null, { tz });
  // hopper.reconciliationRunTime (HH:MM, station time); a changed setting applies at the next worker start.
  const [hh, mm] = (await c.settings.get<string>('hopper.reconciliationRunTime')).split(':');
  await queue.boss.schedule(QUEUES.HOPPER_RECONCILIATION, `${Number(mm)} ${Number(hh)} * * *`, null, { tz });
  await queue.boss.schedule(QUEUES.MAINTENANCE_DUE, '0 6 * * *', null, { tz });

  c.logger.info('worker started');
  return {
    stop: async () => {
      relay.stop();
      await queue.stop();
    },
  };
}
