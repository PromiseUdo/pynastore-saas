/*
 * lib/payments/paystack-webhook.ts
 *
 * The platform's ONE Paystack webhook (ROADMAP 10.5). Paystack sends every
 * event on the integration to a single URL, so subscription billing and
 * storefront payments arrive here together and are told apart by what the
 * reference belongs to — never by anything the body merely claims.
 *
 *   1. The signature (`x-paystack-signature`, an HMAC of the RAW body) is
 *      checked in constant time. Anything else is a 401 and touches nothing.
 *   2. The event is routed:
 *        charge.success, reference is an OrderPayment → reconcilePayment,
 *          which asks Paystack's verify endpoint itself: the body is only
 *          "go and check this reference", as for the callback;
 *        charge.success for a subscription checkout or renewal, and
 *          subscription/invoice events → subscription billing
 *          (lib/billing/webhook-events.ts);
 *        charge.success matching nothing of ours → recorded for platform
 *          staff (lib/payments/unmatched.ts, ROADMAP 11.6);
 *        charge.dispute.* → lib/payments/disputes.ts (or, matching nothing,
 *          recorded for staff too);
 *        refund.* → acknowledged and logged: refunds are paused (ROADMAP 10.7);
 *        anything else → acknowledged.
 *   3. Always 200 once the signature is good — including for events that
 *      fail to process: Paystack retries non-2xx, and a retry storm fixes
 *      nothing. Failures are logged; the return route, the confirmation page
 *      and the expiry job re-check a payment independently.
 *
 * Both /api/payments/paystack/webhook and the older
 * /api/billing/paystack/webhook serve this, so the URL set in Paystack's
 * dashboard can be moved to the neutral one without a gap.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/lib/ops/log';
import { webhookFailed, webhookSucceeded } from '@/lib/ops/webhooks';
import { verifyPaystackSignature } from './paystack';
import { recordDispute } from './disputes';
import { isSubscriptionCharge, recordUnmatched } from './unmatched';
import { handleBillingEvent } from '@/lib/billing/webhook-events';
import { reconcilePayment } from '@/lib/storefront/checkout/payment-service';

export type WebhookRoute = 'storefront' | 'billing' | 'dispute' | 'refund' | 'unmatched' | 'ignored';

/**
 * Decide and act on one verified event. Exported for tests; the route calls
 * it only after the signature has passed.
 */
export async function routePaystackEvent(event: string, data: Record<string, unknown>): Promise<WebhookRoute> {
  if (event === 'charge.success') {
    const reference = typeof data.reference === 'string' ? data.reference : null;
    const isOrderPayment = reference
      ? (await prisma.orderPayment.count({ where: { reference } })) > 0
      : false;
    if (reference && isOrderPayment) {
      const outcome = await reconcilePayment(reference);
      console.info(`[paystack webhook] ${reference}: ${outcome}`);
      return 'storefront';
    }
    // Ours if it's a subscription checkout we started, or a renewal (which
    // Paystack sends with a fresh reference and the plan). Anything else is a
    // payment we can't place: recorded for staff (11.6), credited nowhere.
    const isBilling =
      isSubscriptionCharge(data) || (reference ? (await prisma.billingTransaction.count({ where: { reference } })) > 0 : false);
    if (!isBilling) {
      await recordUnmatched('charge', event, data);
      return 'unmatched';
    }
    await handleBillingEvent(event, data);
    return 'billing';
  }
  if (event.startsWith('charge.dispute.')) {
    const outcome = await recordDispute(event, data);
    console.info(`[paystack webhook] ${event} ${String(data.id ?? '')}: ${outcome}`);
    if (outcome === 'not-ours') await recordUnmatched('dispute', event, data);
    return 'dispute';
  }
  if (event.startsWith('refund.')) {
    console.info(`[paystack webhook] ${event} for ${String(data.transaction_reference ?? '?')} — refunds are paused (ROADMAP 10.7); logged only.`);
    return 'refund';
  }
  if (event.startsWith('subscription.') || event.startsWith('invoice.')) {
    await handleBillingEvent(event, data);
    return 'billing';
  }
  return 'ignored';
}

export async function handlePaystackWebhook(req: Request): Promise<NextResponse> {
  const rawBody = await req.text();

  if (!verifyPaystackSignature(rawBody, req.headers.get('x-paystack-signature'))) {
    await webhookFailed('paystack', { kind: 'signature', message: 'A request arrived with a missing or invalid signature' });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: { event?: unknown; data?: unknown };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await webhookFailed('paystack', { kind: 'body', message: 'A signed request’s body wasn’t valid JSON' });
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const event = typeof payload.event === 'string' ? payload.event : '';
  const data = payload.data && typeof payload.data === 'object' ? (payload.data as Record<string, unknown>) : {};
  try {
    await routePaystackEvent(event, data);
    await webhookSucceeded('paystack');
  } catch (error) {
    /* Still answered 200: Paystack would otherwise retry for up to 72 hours
     * an event we may have half-applied. The failure is recorded and staff
     * alerted instead; a stuck payment can be re-checked from the console
     * (Payments → Stuck → "Check with Paystack"). */
    const reference = typeof data.reference === 'string' ? data.reference : undefined;
    log.error('paystack.webhook.failed', { event, reference }, error);
    await webhookFailed('paystack', {
      kind: 'processing',
      message: `Couldn’t process “${event || 'an event with no name'}”: ${error instanceof Error ? error.message : String(error)}`,
      error,
    });
  }
  return NextResponse.json({ received: true });
}
