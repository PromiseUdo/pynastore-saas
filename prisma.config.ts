/*
 * prisma.config.ts — for the Prisma CLI (migrations, db execute, generate).
 * The app itself connects in lib/prisma.ts.
 *
 * Two addresses for one database (ROADMAP 13.6):
 *   DATABASE_URL  the POOLED address (Neon's "-pooler" host) — what the app
 *                 uses at runtime, so a burst of serverless functions shares
 *                 a small number of real connections;
 *   DIRECT_URL    the DIRECT address (same host without "-pooler") — what
 *                 migrations use. Migrate takes a session-level lock that a
 *                 pooler in transaction mode can't hold, which is the
 *                 "Timed out trying to acquire a postgres advisory lock"
 *                 error. Falls back to DATABASE_URL when unset.
 *   SHADOW_DATABASE_URL  an empty scratch database `migrate dev` and
 *                 `migrate diff --from-migrations` replay history into.
 *                 Never a database with data in it: Prisma wipes it.
 * docs/DATABASE.md has the setup.
 */
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'npx tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DIRECT_URL'] || process.env['DATABASE_URL'],
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'] || undefined,
  },
});
