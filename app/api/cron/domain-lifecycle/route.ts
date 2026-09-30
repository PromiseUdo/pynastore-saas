/*
 * GET /api/cron/domain-lifecycle
 *
 * Expires lapsed custom domains, sends renewal reminders, and emails staff
 * the domains due (lib/domains/lifecycle.ts). Run daily — vercel.json
 * schedules it at 07:00 UTC (08:00 in Lagos).
 */
import { cronRoute } from '@/lib/cron/route';

export const GET = cronRoute('domain-lifecycle');
