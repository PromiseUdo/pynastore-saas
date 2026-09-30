/*
 * POST /api/payments/paystack/webhook
 *
 * The platform's Paystack webhook — subscription billing and storefront
 * payments alike (ROADMAP 10.5). Set this URL in Paystack's dashboard
 * (Settings → API Keys & Webhooks). All the logic is in
 * lib/payments/paystack-webhook.ts.
 */
import type { NextRequest } from 'next/server';
import { handlePaystackWebhook } from '@/lib/payments/paystack-webhook';

export function POST(req: NextRequest) {
  return handlePaystackWebhook(req);
}
