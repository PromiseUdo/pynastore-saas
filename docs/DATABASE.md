# Database

This guide covers how the platform's Postgres (Neon) is connected, changed,
backed up and restored (ROADMAP 13.6).

## Two addresses, one database

| Variable | Which address | Used by |
|---|---|---|
| `DATABASE_URL` | the **pooled** one (Neon host ending `-pooler…`) | the app at runtime (`lib/prisma.ts`) |
| `DIRECT_URL` | the **direct** one (same host without `-pooler`) | migrations (`prisma.config.ts`) |
| `SHADOW_DATABASE_URL` | an **empty scratch** database | `migrate dev` / `migrate diff`, to replay history (development only) |

Why two:
- **The app uses the pooler.** Every serverless instance keeps a few
  connections (5 on Vercel, `DATABASE_POOL_MAX` to change), and Neon's pooler
  shares a small number of real ones between them.
- **Migrations must not use the pooler.** Prisma Migrate holds a session
  lock, which a transaction-mode pooler can't hold properly. Through the
  pooler, a timed-out migration can leave the lock stuck on a pooled
  connection, and every later migration then waits for it ("Timed out trying
  to acquire a postgres advisory lock"). That happened on 2026-09-30; see
  "A stuck migration lock" below.

## Separate development from production

Until this is done, your machine and the live site use **the same
database**. Tests create throwaway shops in it, and schema changes reach live
data the moment they're applied.

1. **Create a development branch.** In the Neon console, open the project →
   **Branches** → **Create branch**:
   - name it `development`;
   - branch it from `main` (today's data, copied instantly);
   - give it its own compute.
2. **Create a shadow database** on that branch: **Databases** → **New
   database** → `shadow`.
3. **Point your local `.env` at the branch**, copying each address from
   **Connection details** for the `development` branch:
   - `DATABASE_URL` = its pooled address
   - `DIRECT_URL` = its direct address (untick "Connection pooling")
   - `SHADOW_DATABASE_URL` = the direct address of the `shadow` database
4. **Set Vercel's variables.** In Project → Settings → Environment Variables:
   - **Production:** `DATABASE_URL` = `main`'s pooled address (as now), and
     add `DIRECT_URL` = `main`'s direct address. Deploys then apply new
     migrations automatically (below).
   - **Preview:** point `DATABASE_URL` at the `development` branch, so a
     preview deploy can never touch live data.
5. **Restart `npm run dev`.**

From then on, `main` is production only. To refresh development with
current data, reset the branch from its parent in the console.

## Changing the schema

1. Edit `prisma/schema.prisma`.
2. Run `npx prisma migrate dev --name what_changed`. This creates the
   migration from the diff and applies it to **your development** database.
   Commit the new folder under `prisma/migrations/`.
3. Deploy. `npm run vercel-build` runs `scripts/db/migrate-on-deploy.mjs`,
   which on a **production** deploy with `DIRECT_URL` set applies the pending
   migrations to `main` before building. It only ever applies committed
   migrations in order, and never resets. Without `DIRECT_URL` it skips, and
   you run `DIRECT_URL=<main direct> npx prisma migrate deploy` yourself.

Never run `migrate dev` or `migrate reset` against production. If `migrate dev`
ever asks to reset, stop. It means the database's history and the folder
disagree (see "Drift").

**Folder order.** Prisma applies migrations in folder-name order. Three
folders are dated `20261001…` (`cron_runs`, `shared_rate_limits`,
`error_log`). A migration created before 2026-10-01 15:00 UTC would be named
earlier than them. If that happens, rename the new folder to sort after
`20261001150000_error_log` **before** applying it. Once a migration is
applied, never rename its folder.

## Drift, and how it was fixed (2026-09-30)

"Drift" means the database, the migration history and the schema don't all
agree. Two things caused it here:

- **A renamed migration.** `20260916191000_order_confirmation_token` was
  applied, then renamed to `…192000…` and applied again. The old name stayed
  in `_prisma_migrations`, so Prisma saw a migration it couldn't find and
  demanded a reset. The stale row was deleted; the database already had
  everything the renamed folder creates.
- **`orders.customerId`.** The database and the history said `ON DELETE
  RESTRICT`, but the schema said nothing, so Prisma's default for an optional
  relation (`SET NULL`) applied. The schema now says `onDelete: Restrict`.
  Nothing in the app deletes customers, and a customer with orders shouldn't
  be deletable out from under them.

**To check there's no drift:**
- live database vs schema:
  `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`
  should say "No difference detected";
- history vs schema:
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script`
  (needs `SHADOW_DATABASE_URL`) should be an empty migration.

## A stuck migration lock

If a migration waits on `pg_advisory_lock(72707369)`, some session holds it.
Find it (in the Neon SQL editor, on the right branch):

```sql
SELECT l.pid, a.application_name, a.state, a.backend_start
FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.locktype = 'advisory' AND l.objid = 72707369;
```

If it's a leftover (for example `application_name = pgbouncer`, idle), end
it with `SELECT pg_terminate_backend(<pid>);`. The app opens a new
connection by itself. Using `DIRECT_URL` for migrations stops this from
happening.

## Backups

There are two layers.

**Neon's own history (point-in-time restore).**
- Neon keeps a history of the database for a window that depends on the
  plan; see the project's settings for how far back.
- To go back, create a branch from `main` **at a past time**, check it, then
  point production at it or copy what's needed.
- This is the fastest recovery from "we deleted the wrong thing an hour
  ago".

**Our nightly backup (GitHub Actions, `.github/workflows/db-backup.yml`).**
- It dumps the database and counts every table's rows in the same snapshot.
- It encrypts the dump (AES-256, `BACKUP_PASSPHRASE`) and keeps it for
  30 days as a workflow artifact.
- **Every night it also restores the backup** into a scratch Postgres and
  checks every table's row count against the dump. A backup that can't be
  restored fails the run, and GitHub emails you.
- It's independent of Neon: if the Neon project were lost, this is what's
  left.
- **Setup** (repository → Settings → Secrets and variables → Actions):
  - `BACKUP_DATABASE_URL` = `main`'s **direct** address
  - `BACKUP_PASSPHRASE` = a long random passphrase (`openssl rand -base64 32`).
    Keep it in a password manager too: without it, the backups can't be
    opened.
- Then run it once by hand: Actions → Database backup → Run workflow.

The backups hold shoppers' and merchants' personal data. They're encrypted,
kept 30 days, and readable only by someone with both repository access and
the passphrase.

### Restoring a nightly backup by hand

1. Download the artifact from the workflow run and unzip it. It contains
   `notely-<date>.tar.gpg`.
2. Create an **empty** target, such as a new Neon branch with its data
   removed, or a local `pgvector/pgvector:pg17` container. It needs the
   `vector` extension available.
3. Run it with Postgres 17 tools:
   `BACKUP_PASSPHRASE=… scripts/db/restore.sh notely-<date>.tar.gpg <target url>`.
   It prints `Restore verified: N tables, M rows` or fails loudly.
4. Check it, then point `DATABASE_URL` / `DIRECT_URL` at it.

**Rehearsed on 2026-09-30:**
- A dump of the live database was restored into a scratch Postgres 17 with
  pgvector: 96 tables and 1,816 rows, all identical.
- Photo-search vectors and the rate-limit function came back working.
- The wrong passphrase couldn't open the backup.
