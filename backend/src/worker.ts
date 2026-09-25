/** Standalone worker entry point (Render Background Worker: `npm run start:worker`). */
import './load-env.js';
import { loadEnv } from './config/env.js';
import { createContainer } from './container.js';
import { createPool } from './db/pool.js';
import { startWorker } from './jobs/worker.js';
import { createLogger } from './logger.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env);
  const pool = createPool({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL, max: 4, applicationName: 'cws-worker' });
  const worker = await startWorker(createContainer(env, pool, logger));
  const shutdown = async () => {
    await worker.stop().catch((err) => logger.error({ err }, 'worker stop failed'));
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
