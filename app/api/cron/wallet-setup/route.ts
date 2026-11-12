/*
 * GET /api/cron/wallet-setup
 *
 * Sets up shoppers' and shops' EduPay wallets EduPay didn't answer for, and
 * settles top-ups nobody stayed to see land (lib/wallet/jobs.ts, ROADMAP
 * 20.2–20.4). Every 15 minutes; see lib/cron/jobs.ts for who calls it and
 * docs/SCHEDULED-JOBS.md for the setup.
 */
import { cronRoute } from '@/lib/cron/route';

export const GET = cronRoute('wallet-setup');
