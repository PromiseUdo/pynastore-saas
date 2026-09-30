/*
 * GET /api/payments/paystack/callback?ref=…
 *
 * Paystack sends the shopper's browser here after its payment page (it also
 * appends `trxref` and `reference`). The reference is only used to ask
 * Paystack, server to server, what happened; the shopper then goes to the
 * return address stored on the attempt. The webhook (ROADMAP 10.5) and the
 * confirmation page are the other doors to the same idempotent check.
 */
import type { NextRequest } from 'next/server';
import { handlePaymentReturn } from '@/lib/storefront/payments/payment-return';

export function GET(req: NextRequest) {
  return handlePaymentReturn(req, 'paystack');
}
