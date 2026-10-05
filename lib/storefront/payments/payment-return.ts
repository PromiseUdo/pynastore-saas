/*
 * lib/storefront/payments/payment-return.ts
 *
 * The browser's way back from Paystack's payment page, used by
 * /api/payments/paystack/callback. (It was shared with a Squad route until
 * Squad was retired in ROADMAP 10.9.)
 *
 * IN THE PHONE APP the payment page runs in an in-app browser on top of the
 * app (./open-payment-page.ts). Redirecting that browser to the store would
 * leave the shopper inside it, so instead this answers with a small page that
 * hands back to the app by deep link; the app closes the sheet and shows the
 * confirmation itself.
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  paymentReturn,
  reconcilePayment,
  type ReconcileOutcome,
} from '@/lib/storefront/checkout/payment-service';
import { SHARED_APP_ID } from '@/lib/mobile/app-config';
import { appDeepLink, deepLinkPage } from '@/lib/mobile/deep-link-page';

/** Our reference, from our own `ref` or whatever the provider appended. */
function referenceFrom(req: NextRequest): string | null {
  const params = req.nextUrl.searchParams;
  const raw = params.get('ref') ?? params.get('reference') ?? params.get('transaction_ref');
  // If a provider appends "?reference=…" to a URL that already had a query,
  // the value arrives as "REF?reference=REF" — keep the part before it.
  const ref = raw?.split('?')[0].trim();
  return ref ? ref.slice(0, 120) : null;
}

/**
 * Back to the app the payment began in: a store's own app, or the shared one
 * (every attempt from before ROADMAP 16.1). The scheme was checked against
 * the registered apps when the attempt was made, never taken from this request.
 */
function appHandoffPage(outcome: ReconcileOutcome, reference: string, scheme: string | null): NextResponse {
  const heading =
    outcome === 'paid' || outcome === 'already-paid'
      ? 'Payment received'
      : outcome === 'failed'
        ? 'Payment didn’t go through'
        : 'Checking your payment';

  return deepLinkPage({
    heading,
    deepLink: appDeepLink(scheme || SHARED_APP_ID, 'payment-return', { ref: reference }),
  });
}

/**
 * Where a payment provider sends the shopper's browser back. Nothing in the
 * query string is believed: the reference only says which attempt to check,
 * server to server (reconcilePayment), and the shopper is sent to the return
 * address stored on the attempt — never a URL from the request, so this can't
 * be used as an open redirect.
 */
export async function handlePaymentReturn(req: NextRequest, label: string): Promise<NextResponse> {
  const reference = referenceFrom(req);
  const home = new URL('/', req.url);
  if (!reference) return NextResponse.redirect(home);

  const attempt = await paymentReturn(reference);
  if (!attempt) return NextResponse.redirect(home);

  // A failure to verify is not a failure to pay: the confirmation page checks
  // again on load, and the webhook will settle it regardless.
  const outcome = await reconcilePayment(reference).catch((error): ReconcileOutcome => {
    console.error(`[${label} callback] ${reference}:`, error);
    return 'error';
  });

  if (attempt.nativeApp) return appHandoffPage(outcome, reference, attempt.nativeAppScheme);
  return NextResponse.redirect(attempt.returnUrl);
}
