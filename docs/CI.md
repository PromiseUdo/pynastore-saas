# Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request (ROADMAP 13.7).

| Step | Catches |
|---|---|
| `npm ci` | a lockfile that doesn't match `package.json` |
| `tsc --noEmit` | type errors |
| `prisma migrate deploy` into an empty Postgres | a migration that doesn't apply from scratch |
| `prisma migrate diff … --exit-code` | `schema.prisma` changed without a migration |
| `vitest run --no-file-parallelism` | every test, **database suites included** |
| `next build` | build-only errors, e.g. a non-function export from a `'use server'` file |

## The database is CI's own

- **What it is.** A throwaway **Postgres 17 + pgvector** (what Neon runs),
  started for the run and built from `prisma/migrations`. It never touches
  Neon or any real data.
- **Why the whole suite runs every time.** On a database next to the tests,
  all 1,800 tests take about a minute. So the database suites run on every
  push, not only "before a release" as first planned; that plan was only
  because of Neon's latency.
- **Why `--no-file-parallelism` stays.** The suites share one database.

## Settings: `.env.ci`

- **What's in it.** Placeholders for everything the code reads at load time
  (auth secret, Resend, Cloudinary, Meta, Paystack…). It's committed on
  purpose: tests mock every outside service, so nothing real is ever called.
- **Never put a real key in it.**
- **When a new required setting is added** to the app, add a placeholder
  here too, or CI fails at import.

## Run the same thing locally

```sh
colima start               # Docker, on this Mac
npm run test:local         # whole suite, fresh database, .env.ci settings
npm run test:local -- tests/rate-limit.test.ts   # just some files
npm run typecheck
npm run db:drift           # your database vs schema.prisma
```

`test:local` leaves a container called `notely-test-db` running for the next
run. Remove it with `docker rm -f notely-test-db`.

## What CI doesn't do

- **It doesn't block a deploy.** Vercel deploys a push whether or not CI
  passed. Merge to `master` when CI is green. If your GitHub plan offers
  required status checks for this repository, require "CI / check" on
  `master` to enforce it.
- **Minutes.** A run takes about 4–5 minutes, including installing. GitHub's
  free private-repository allowance (2,000 minutes a month) covers a few
  hundred pushes; the nightly backup (`db-backup.yml`) uses a few more.
