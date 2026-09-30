# Monitoring

How the platform notices when something goes wrong (ROADMAP 13.3). For the
scheduled jobs and their alerts, see `SCHEDULED-JOBS.md`.

## The error log

Everything below is recorded on the live site only (`VERCEL_ENV=production`),
or anywhere `ERROR_LOG=on` is set. It appears at **Console → Errors**
(`/platform/errors`).

| Source | What's caught | How |
|---|---|---|
| Server | Any error Next.js catches while rendering a page, in an API route, a server action or the proxy | `instrumentation.ts` → `lib/ops/server-errors.ts` |
| Browser | Uncaught errors and unhandled promise rejections, plus errors an error page (`error.tsx`) catches | `instrumentation-client.ts`, `RouteError` / `useReportError` → `POST /api/client-errors` |
| Browser (policy) | What the Content Security Policy blocked (ROADMAP 13.4), extensions excluded | `report-uri` → `POST /api/csp-report` |
| Webhook | Paystack webhook: bad signatures, unreadable bodies, events we couldn't process. Meta callback: token exchanges or errors Meta refused | `lib/ops/webhooks.ts` |

- **Grouping.** Occurrences of the same problem become one entry: same source
  and place, and the same message once ids, numbers and quoted values are
  blanked.
- **What's kept.** Each occurrence is kept for 14 days. A group nobody has
  seen for 90 days is deleted.
- **Privacy.** Paths are kept without their query string, and token-looking
  segments (reset, verify and confirmation links) are replaced with `:token`,
  so the log never holds a working link.
- **Noise.** Browser noise is dropped: extensions, flaky connections, a tab
  left open across a deploy.
- **Server errors reaching the browser.** A browser error that came from the
  server (it has a `digest`) isn't sent twice.
- **Handled errors.** An error a caller catches and turns into a friendly
  message never reaches the log. Where one still deserves a look, call
  `reportCaughtError(error, 'where')` from `lib/ops/errors.ts`.

### Who is emailed

Emails go to `PLATFORM_ADMIN_EMAIL`, a comma-separated list:

- **A new server or webhook error.** At most 10 such emails an hour; past
  that, the console has the rest. A new browser error alone doesn't email,
  because browsers are noisy.
- **An error marked resolved happens again.** It reopens, and staff are told.
- **A spike.** 30 server, 10 webhook or 50 browser occurrences of one error
  in an hour. This emails at most every 6 hours while it lasts.
- **A webhook failing.** 3 failures within 30 minutes, then "working again" at
  its next success.

### Paystack webhook failures still answer 200

If Paystack gets an error back, it retries the event for up to 72 hours,
possibly after we've half-applied it. So the webhook still says "received".
The failure is recorded and alerted instead. A payment that never confirmed
can be re-checked from **Console → Payments → Stuck**.

## Health check and uptime

`GET /api/health` answers **200** `{"status":"ok"}` when the app is up and
can reach its database, and **503** when it can't. It says nothing else.

Monitor it from cron-job.org (the same free account as the scheduled jobs):

1. Create a cron job with the URL `https://<production host>/api/health`. It
   needs no header.
2. Set the schedule to **every 15 minutes**. Checking more often would keep
   the Neon database awake around the clock, which uses up its free compute
   hours; the 15-minute jobs wake it at the same times anyway.
3. Turn on its failure notification email. This is the one alarm that works
   when our own site is down, because none of our own alerts can send then.

## Structured logs

`lib/ops/log.ts` writes one JSON object per line, for example
`{"level":"error","event":"paystack.webhook.failed","reference":"…",…}`,
so Vercel's log search can filter on any field. The error log, the cron
runner and the webhooks use it. Older `console.error` lines elsewhere still
work, and every thrown server error reaches the error log whatever it
logged.
