# Scheduled jobs

The platform runs four chores on a timer (ROADMAP 13.1). Each one is a web
address under `/api/cron/` that only answers a caller who sends
`Authorization: Bearer <CRON_SECRET>`.

| Job | Address | How often | Who calls it |
|---|---|---|---|
| Release unpaid orders | `/api/cron/expire-unpaid-orders` | every 15 minutes | cron-job.org (for now) |
| Index photos for search by image | `/api/cron/index-product-images` | every 15 minutes | cron-job.org (for now) |
| Domain renewals | `/api/cron/domain-lifecycle` | daily, 07:00 UTC | Vercel Cron (`vercel.json`) |
| Setup and trial reminders | `/api/cron/onboarding-reminders` | daily, 08:00 UTC | Vercel Cron (`vercel.json`) |

What each one does is written in `lib/cron/jobs.ts`, and is also shown on the
console's **Scheduled jobs** page (`/platform/jobs`).

## Why two schedulers

Vercel's Hobby plan only allows cron jobs that run once a day, and a deploy
fails if `vercel.json` asks for more. The two 15-minute jobs are therefore
called from [cron-job.org](https://cron-job.org) (free) until the project
moves to Vercel Pro.

## Setting up cron-job.org

1. Make sure `CRON_SECRET` is set in Vercel (Project → Settings →
   Environment Variables, Production), and redeploy if you just added it. Any
   long random string will do, e.g. from `openssl rand -hex 32`.
2. Create a free account at cron-job.org.
3. Create a cron job for **Release unpaid orders**:
   - **URL:** `https://<production host>/api/cron/expire-unpaid-orders`. Any
     host that serves the app works, because `/api` is outside the tenant
     routing.
   - **Schedule:** every 15 minutes.
   - **Request headers** (under the advanced settings): name `Authorization`,
     value `Bearer ` followed by your `CRON_SECRET`, with one space after
     "Bearer".
   - **Notifications:** turn on the email for failed runs. It is a second
     alarm alongside ours, and the one that still works if our database or
     email is the thing that's down.
4. Do the same for **Index photos for search by image** at
   `/api/cron/index-product-images`.
5. Check it worked: use the job's "test run" on cron-job.org and expect
   **200**, or open `/platform/jobs`, where a run appears within 15 minutes.
   A **401** means the header's secret doesn't match `CRON_SECRET`.

cron-job.org stops waiting for an answer after about 30 seconds. The photo
job can take longer, and keeps running on Vercel after cron-job.org gives up,
so a "timeout" there is not necessarily a failure. The console's **Scheduled
jobs** page records how each run actually ended, so check there.

## Moving to Vercel Pro

Add the two frequent jobs to `vercel.json`:

```json
{ "path": "/api/cron/expire-unpaid-orders", "schedule": "*/15 * * * *" },
{ "path": "/api/cron/index-product-images", "schedule": "*/15 * * * *" }
```

Deploy, check that runs marked "Schedule" appear on `/platform/jobs`, then
delete the two jobs on cron-job.org. No application code changes. The one
test to update is in `tests/cron-runs.test.ts`: it checks that `vercel.json`
holds only daily schedules, because a Hobby deploy with anything more
frequent fails.

## When something goes wrong

- **Every run is recorded** in `CronRun`, whichever scheduler started it, or
  when staff press **Run now** in the console. Runs are kept for 30 days.
- **A scheduled run that fails** emails `PLATFORM_ADMIN_EMAIL` (a
  comma-separated list works). While the job stays broken it emails at most
  every 6 hours, and sends once more when the job works again.
- **A job that stops being called** fails nothing, so a failure email alone
  would never notice it. After every run, the other jobs are checked, and one
  that hasn't run for three of its beats (45 minutes for a 15-minute job; 26
  hours for a daily one) gets a "hasn't run when it should have" email. The
  daily Vercel jobs therefore watch the cron-job.org ones, and the other way
  round.
- A job that has never run isn't reported just for being new. It counts as
  late only once its window has passed since runs were first recorded, so a
  daily job deployed in the afternoon isn't reported until the next morning
  has come and gone.
- The console's overview and sidebar count jobs that are failing or late.
