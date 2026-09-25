import type pg from 'pg';
import { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import type { TransactionalQueue } from '../outbox/outbox.service.js';

/** Queue names. Scanners from ARCHITECTURE.md §12 are added here phase by phase. */
export const QUEUES = {
  DOMAIN_EVENTS: 'domain-events',
  MAINTENANCE_PURGE: 'maintenance.purge-expired',
} as const;

/**
 * pg-boss wrapper (replaces BullMQ + Redis). Jobs live in the "pgboss" schema of
 * the same PostgreSQL database, so enqueueing can join a business transaction.
 */
export class JobQueue implements TransactionalQueue {
  readonly boss: PgBoss;

  constructor(connectionString: string, ssl: boolean, private readonly logger: Logger) {
    this.boss = new PgBoss({
      connectionString,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
      schema: 'pgboss',
      application_name: 'cws-worker',
      max: 4,
    });
    this.boss.on('error', (err) => this.logger.error({ err }, 'pg-boss error'));
  }

  async start(): Promise<void> {
    await this.boss.start();
    for (const name of Object.values(QUEUES)) {
      await this.boss.createQueue(name, { retryLimit: 5, retryBackoff: true, retryDelay: 10 }).catch((err: Error) => {
        if (!/already exists/i.test(err.message)) throw err;
      });
    }
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }

  async sendInTx(tx: pg.PoolClient, queue: string, data: object, opts: { singletonKey?: string } = {}): Promise<void> {
    await this.boss.send(queue, data, {
      ...(opts.singletonKey ? { singletonKey: opts.singletonKey } : {}),
      db: { executeSql: (text: string, values?: unknown[]) => tx.query(text, values as unknown[]) },
    });
  }
}
