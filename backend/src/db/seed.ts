/** CLI: `npm run seed` — idempotent (roles, permissions, settings, first SUPER_ADMIN). */
import '../load-env.js';
import { createPool } from './pool.js';
import { seed } from './seed-lib.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = createPool({ connectionString: url, ssl: process.env.DATABASE_SSL === 'true', max: 2, applicationName: 'cws-seed' });
  try {
    const r = await seed(pool, {
      username: process.env.SEED_ADMIN_USERNAME ?? 'admin',
      fullName: process.env.SEED_ADMIN_FULL_NAME ?? 'System Administrator',
      password: process.env.SEED_ADMIN_PASSWORD || undefined,
    });
    console.log(
      `[seed] roles +${r.rolesCreated}, permissions +${r.permissionsCreated}, grants +${r.grants}, settings +${r.settingsCreated}` +
        (r.adminCreated ? `, SUPER_ADMIN "${process.env.SEED_ADMIN_USERNAME ?? 'admin'}" created (must change password at first login)` : ''),
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
