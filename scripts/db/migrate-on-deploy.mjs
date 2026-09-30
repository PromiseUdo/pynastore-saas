/*
 * scripts/db/migrate-on-deploy.mjs — run by `npm run vercel-build` (ROADMAP 13.6).
 *
 * On a PRODUCTION deploy, applies any migrations the production database
 * doesn't have yet (`prisma migrate deploy`) before the new code is built, so
 * code and database never disagree. It only ever applies committed
 * migrations, in order, and never resets anything.
 *
 * It does nothing unless DIRECT_URL is set (migrations can't run through the
 * pooler), and nothing on preview deploys — a preview must never change the
 * production database, and until development has its own database, previews
 * would share it.
 */
import { execFileSync } from 'node:child_process';

if (process.env.VERCEL_ENV !== 'production') {
  console.log(`[migrate] Not a production deploy (${process.env.VERCEL_ENV ?? 'local'}) — skipping migrations.`);
  process.exit(0);
}
if (!process.env.DIRECT_URL) {
  console.log('[migrate] DIRECT_URL is not set — skipping migrations. Apply them by hand (docs/DATABASE.md).');
  process.exit(0);
}
console.log('[migrate] Applying pending migrations to the production database…');
execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
