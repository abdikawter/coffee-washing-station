/**
 * CLI: `npm run migrate` applies pending SQL migrations; `--status` lists them.
 * Needs only DATABASE_URL (and DATABASE_SSL) so it can run as a Render pre-deploy step.
 */
import '../load-env.js';
import { createPool } from './pool.js';
import { migrate, migrationStatus } from './migrator.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = createPool({ connectionString: url, ssl: process.env.DATABASE_SSL === 'true', max: 2, applicationName: 'cws-migrate' });
  try {
    if (process.argv.includes('--status')) {
      const s = await migrationStatus(pool);
      for (const a of s.applied) console.log(`applied  ${a.version}_${a.name}  ${a.appliedAt.toISOString()}`);
      for (const p of s.pending) console.log(`pending  ${p.file}`);
      return;
    }
    const applied = await migrate(pool, { log: (m) => console.log(`[migrate] ${m}`) });
    console.log(applied.length ? `[migrate] applied ${applied.length} migration(s)` : '[migrate] database is up to date');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
