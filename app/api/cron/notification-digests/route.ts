/*
 * GET /api/cron/notification-digests
 *
 * Each member's one daily email of low-stock alerts and product questions
 * they haven't seen yet (lib/notifications/digest.ts, ROADMAP 18.6). Daily;
 * see lib/cron/jobs.ts and docs/SCHEDULED-JOBS.md.
 */
import { cronRoute } from '@/lib/cron/route';

export const GET = cronRoute('notification-digests');
