/*
 * GET /api/cron/data-retention
 *
 * Carries out the data-retention rules (lib/data-rights/retention.ts): closed
 * workspaces cleared after 30 days and erased after 6 years, deleted
 * shoppers' details removed from records past 6 years. Daily — vercel.json
 * schedules it at 03:00 UTC (04:00 in Lagos).
 */
import { cronRoute } from '@/lib/cron/route';

// Erasing a workspace can take a while.
export const maxDuration = 60;

export const GET = cronRoute('data-retention');
