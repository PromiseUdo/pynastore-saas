/*
 * POST /api/payments/squad/webhook
 *
 * Squad's server tells us a transaction changed. One URL for every merchant:
 * the platform's Squad account takes all storefront payments, and the
 * transaction reference is what finds the order (and so the store).
 *
 * Two locks, in order:
 *   1. the signature — `x-squad-encrypted-body`, an HMAC of the RAW body, so
 *      this reads text() before parsing;
 *   2. the body is then NOT trusted for anything but the reference.
 *      reconcilePayment asks Squad's verify endpoint what happened, checks
 *      the amount and currency, and settles idempotently.
 *
 * Always 200 once the signature is good, including for references that aren't
 * ours or that fail to process: Squad retries non-2xx responses, and a retry
 * storm fixes nothing. Failures are logged, and the callback and the
 * confirmation page re-check the same payment independently.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyWebhookSignature, webhookTransactionRef } from '@/lib/payments/squad';
import { reconcilePayment } from '@/lib/storefront/checkout/payment-service';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!verifyWebhookSignature(rawBody, req.headers.get('x-squad-encrypted-body'))) {
    console.warn('[squad webhook] Rejected a request with a missing or invalid signature.');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const reference = webhookTransactionRef(payload);
  if (reference) {
    try {
      const outcome = await reconcilePayment(reference);
      if (outcome !== 'unknown-reference') {
        console.info(`[squad webhook] ${reference}: ${outcome}`);
      }
    } catch (error) {
      console.error(`[squad webhook] Failed to process ${reference}:`, error);
    }
  }

  return NextResponse.json({ received: true });
}
