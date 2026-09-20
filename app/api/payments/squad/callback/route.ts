/*
 * GET /api/payments/squad/callback?ref=…
 *
 * Squad sends the shopper's browser here after its payment page. Nothing in
 * the query string is believed: the reference is only used to ask Squad,
 * server to server, what really happened (reconcilePayment), and the shopper
 * is then sent to the return address stored on the attempt when it was
 * created — never to a URL taken from the request, so this can't be used as
 * an open redirect.
 *
 * IN THE PHONE APP the payment page runs in an in-app browser on top of the
 * app (lib/storefront/payments/open-payment-page.ts). Redirecting that
 * browser to the store would leave the shopper inside it, so instead this
 * answers with a small page that hands back to the app by deep link; the app
 * closes the sheet and shows the confirmation itself.
 *
 * The webhook is the other door to the same check; whichever arrives first
 * settles the order, and the second finds nothing left to do.
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  paymentReturn,
  reconcilePayment,
  type ReconcileOutcome,
} from '@/lib/storefront/checkout/payment-service';

const APP_URL_SCHEME = process.env.NEXT_PUBLIC_MOBILE_APP_SCHEME || 'com.mansaas.app';

/** Our reference, from our own `ref` or whatever Squad appended. */
function referenceFrom(req: NextRequest): string | null {
  const params = req.nextUrl.searchParams;
  const raw = params.get('ref') ?? params.get('reference') ?? params.get('transaction_ref');
  // If Squad appends "?reference=…" to a URL that already had a query, the
  // value arrives as "REF?reference=REF" — keep the part before it.
  const ref = raw?.split('?')[0].trim();
  return ref ? ref.slice(0, 120) : null;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function appHandoffPage(outcome: ReconcileOutcome, reference: string): NextResponse {
  const deepLink = `${APP_URL_SCHEME}://payment-return?ref=${encodeURIComponent(reference)}`;
  const heading =
    outcome === 'paid' || outcome === 'already-paid'
      ? 'Payment received'
      : outcome === 'failed'
        ? 'Payment didn’t go through'
        : 'Checking your payment';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f6f2e2; color: #001822; text-align: center; }
  @media (prefers-color-scheme: dark) { body { background: #0b0b0c; color: #f4f1e6; } a { background: #f4f1e6 !important; color: #0b0b0c !important; } }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { font-size: 15px; line-height: 1.5; opacity: .75; margin: 0 0 24px; }
  a { display: inline-block; padding: 14px 28px; border-radius: 999px; background: #001822; color: #fff;
    font-weight: 600; text-decoration: none; }
</style>
</head>
<body>
  <main>
    <h1>${escapeHtml(heading)}</h1>
    <p>Taking you back to the app…</p>
    <a href="${escapeHtml(deepLink)}">Return to the app</a>
  </main>
  <script>setTimeout(function () { window.location.href = ${JSON.stringify(deepLink)}; }, 300);</script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: NextRequest) {
  const reference = referenceFrom(req);
  const home = new URL('/', req.url);
  if (!reference) return NextResponse.redirect(home);

  const attempt = await paymentReturn(reference);
  if (!attempt) return NextResponse.redirect(home);

  // A failure to verify is not a failure to pay: the confirmation page checks
  // again on load, and the webhook will settle it regardless.
  const outcome = await reconcilePayment(reference).catch((error): ReconcileOutcome => {
    console.error(`[squad callback] ${reference}:`, error);
    return 'error';
  });

  if (attempt.nativeApp) return appHandoffPage(outcome, reference);
  return NextResponse.redirect(attempt.returnUrl);
}
