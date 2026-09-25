import type pg from 'pg';
import { z } from 'zod';
import { migrationStatus } from '../../db/migrator.js';
import type { Api } from '../../http/api.js';

/** Liveness and readiness (Render health check → /api/v1/health/ready). */
export function registerHealthRoutes(api: Api, pool: pg.Pool, version: string): void {
  api.route('Health', {
    method: 'get', path: '/health/live', summary: 'Liveness',
    access: { public: true },
    response: { status: 200, description: 'Process is up', schema: z.object({ status: z.literal('ok'), version: z.string() }) },
    handler: async () => ({ status: 'ok' as const, version }),
  });

  api.route('Health', {
    method: 'get', path: '/health/ready', summary: 'Readiness: database reachable and migrations applied',
    access: { public: true },
    response: {
      status: 200, description: 'Ready',
      schema: z.object({ status: z.enum(['ok', 'degraded']), database: z.string(), pendingMigrations: z.array(z.string()) }),
    },
    handler: async ({ res }) => {
      try {
        await pool.query('SELECT 1');
        const { pending } = await migrationStatus(pool);
        const ok = pending.length === 0;
        res.status(ok ? 200 : 503);
        return { status: ok ? ('ok' as const) : ('degraded' as const), database: 'up', pendingMigrations: pending.map((p) => p.file) };
      } catch {
        res.status(503);
        return { status: 'degraded' as const, database: 'down', pendingMigrations: [] };
      }
    },
  });
}
