/*
 * GET /api/cron/expire-unpaid-orders
 *
 * Cancels online-payment orders that nobody paid for within the hold window
 * and puts their stock back on sale (lib/storefront/orders/lifecycle.ts).
 *
 * The same sweep already runs lazily — before each new order in a store, and
 * when the merchant opens their orders — so this is for quiet stores, where
 * nobody would otherwise trigger it. Every 15 minutes; see lib/cron/jobs.ts
 * for who calls it and docs/SCHEDULED-JOBS.md for the setup.
 */
import { cronRoute } from '@/lib/cron/route';

export const GET = cronRoute('expire-unpaid-orders');
