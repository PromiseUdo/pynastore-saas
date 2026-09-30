/*
 * lib/ops/client-report.ts
 *
 * The browser's half of the error log (ROADMAP 13.3): send an error to
 * /api/client-errors, which files it (lib/ops/errors.ts). Called by
 * instrumentation-client.ts for uncaught errors and rejections, and by the
 * error boundaries for errors they catch.
 *
 * Kept small and polite: production builds only, at most five reports per
 * page load, never the same message twice, and never an error that came
 * from the server (it carries a `digest`, and the server already filed it).
 * Only the path is sent — no query string, no page content, nothing typed.
 */
const MAX_PER_PAGE = 5;
const sent = new Set<string>();

export function reportClientError(error: unknown, kind: 'browser' | 'rejection' | 'boundary' = 'browser'): void {
  try {
    if (process.env.NODE_ENV !== 'production' || typeof window === 'undefined') return;
    const err = error instanceof Error ? (error as Error & { digest?: string }) : null;
    if (err?.digest) return;
    const message = (err?.message || (typeof error === 'string' ? error : '') || 'An error with no message').slice(0, 1000);
    if (sent.size >= MAX_PER_PAGE || sent.has(message)) return;
    sent.add(message);

    const body = JSON.stringify({ message, stack: err?.stack?.slice(0, 4000) ?? null, path: window.location.pathname, kind });
    const url = '/api/client-errors';
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return;
    void fetch(url, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
  } catch {
    // Reporting an error must never cause one.
  }
}
