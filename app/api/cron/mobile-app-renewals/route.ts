/*
 * GET /api/cron/mobile-app-renewals
 *
 * Renewal reminders for stores' own apps, the grace period, and switching off
 * an app that wasn't renewed (lib/mobile/renewals.ts). Run daily — vercel.json
 * schedules it at 07:30 UTC (08:30 in Lagos).
 */
import { cronRoute } from '@/lib/cron/route';

export const GET = cronRoute('mobile-app-renewals');
