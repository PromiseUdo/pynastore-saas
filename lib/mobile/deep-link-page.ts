/*
 * lib/mobile/deep-link-page.ts
 *
 * The small page an in-app browser sheet lands on when a trip outside the app
 * is over — Paystack's payment page, Google sign-in — which hands the shopper
 * back to the app by deep link. The app catches the link (`appUrlOpen`),
 * closes the sheet and carries on itself.
 *
 * Its own HTML rather than a React page: it is answered from an API route,
 * outside every layout, and must work in a bare browser sheet.
 */
import { NextResponse } from 'next/server';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** `{scheme}://{host}?{params}` — the scheme is an app id (ROADMAP 16.1). */
export function appDeepLink(scheme: string, host: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString();
  return `${scheme}://${host}${query ? `?${query}` : ''}`;
}

export function deepLinkPage(input: { heading: string; deepLink: string }): NextResponse {
  const { heading, deepLink } = input;
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
