/*
 * scripts/db/migrate-on-deploy.mjs — run by `npm run vercel-build` (ROADMAP 13.6).
 *
 * On a PRODUCTION deploy, applies any migrations the production database
 * doesn't have yet (`prisma migrate deploy`) before the new code is built, so
 * code and database never disagree. It only ever applies committed
 * migrations, in order, and never resets anything.
 *
 * It does nothing unless DIRECT_URL is set (migrations can't run through the
 * pooler).
 *
 * STAGING (docs/STAGING.md): a deploy of the `dev` branch applies migrations
 * to the staging database too — but only when that deployment says it has a
 * staging database of its own (STAGING_DATABASE=yes, set only in Vercel's
 * Preview settings next to the staging DATABASE_URL/DIRECT_URL). Any other
 * preview (a feature branch) never migrates: it shares staging's database,
 * and a migration that isn't merged into `dev` yet must not land there.
 */
import { execFileSync } from 'node:child_process';

const env = process.env.VERCEL_ENV;
const branch = process.env.VERCEL_GIT_COMMIT_REF;
const stagingDeploy = env === 'preview' && branch === 'dev' && process.env.STAGING_DATABASE === 'yes';

if (env !== 'production' && !stagingDeploy) {
  console.log(`[migrate] Not a production or staging (dev) deploy (${env ?? 'local'}${branch ? `, ${branch}` : ''}) — skipping migrations.`);
  process.exit(0);
}
if (!process.env.DIRECT_URL) {
  console.log('[migrate] DIRECT_URL is not set — skipping migrations. Apply them by hand (docs/DATABASE.md).');
  process.exit(0);
}
console.log(`[migrate] Applying pending migrations to the ${stagingDeploy ? 'staging' : 'production'} database…`);
execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
