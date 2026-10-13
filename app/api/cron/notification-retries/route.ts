/*
 * GET /api/cron/notification-retries
 *
 * Retries notifications that failed for a passing reason
 * (lib/notifications/outbox.ts, ROADMAP 18.1). Every 5 minutes; see
 * lib/cron/jobs.ts for who calls it and docs/SCHEDULED-JOBS.md for the setup.
 */
import { cronRoute } from '@/lib/cron/route';

export const GET = cronRoute('notification-retries');
