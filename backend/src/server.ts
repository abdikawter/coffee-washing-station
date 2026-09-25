import './load-env.js';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createContainer } from './container.js';
import { createPool } from './db/pool.js';
import { startWorker } from './jobs/worker.js';
import { createLogger } from './logger.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env);
  const pool = createPool({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL, max: env.DATABASE_POOL_MAX });
  pool.on('error', (err) => logger.error({ err }, 'idle database client error'));
  const container = createContainer(env, pool, logger);
  const { app } = createApp(container);

  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'API listening'));
  const worker = env.RUN_WORKER_IN_PROCESS ? await startWorker(container) : undefined;

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
    server.close();
    await worker?.stop().catch((err) => logger.error({ err }, 'worker stop failed'));
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
