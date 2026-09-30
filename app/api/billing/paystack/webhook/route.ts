/*
 * POST /api/billing/paystack/webhook
 *
 * The URL Paystack's dashboard has pointed at since subscription billing was
 * built. Paystack sends EVERY event on the integration to one URL, so since
 * storefront payments moved to Paystack (ROADMAP 10.4) this serves both,
 * through the same handler as /api/payments/paystack/webhook — whichever of
 * the two the dashboard names, nothing is missed. Prefer the neutral one; this
 * stays until the dashboard has been switched.
 */
import type { NextRequest } from 'next/server';
import { handlePaystackWebhook } from '@/lib/payments/paystack-webhook';

export function POST(req: NextRequest) {
  return handlePaystackWebhook(req);
}
