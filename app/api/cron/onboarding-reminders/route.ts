/*
 * GET /api/cron/onboarding-reminders
 *
 * Sends the onboarding reminders that are due (lib/onboarding/reminders.ts):
 * setup nudges on days 3 and 7 of a trial while the shop isn't open, and
 * "your trial ends soon" 3 days and 1 day before. Each is sent once. Run
 * daily — vercel.json schedules it at 08:00 UTC (09:00 in Lagos).
 */
import { cronRoute } from '@/lib/cron/route';

export const GET = cronRoute('onboarding-reminders');
