/*
 * lib/ops/error-shape.ts
 *
 * How an error is grouped and what of it is kept (ROADMAP 13.3). Pure, so it
 * can be tested without a database. Server only (it hashes with node:crypto).
 *
 * Two errors are "the same" when they come from the same source and place
 * and say the same thing once ids, numbers and quoted values are blanked —
 * "Order clx81… not found" and "Order clx92… not found" are one problem.
 *
 * Paths are scrubbed before they're kept: the query string is dropped, and
 * long random-looking segments (reset, verify and confirmation tokens) are
 * replaced, so the error log never holds a working link.
 */
import { createHash } from 'crypto';

const MAX_MESSAGE = 500;

/** Blank the parts of a message that differ between occurrences of the same problem. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\bc[a-z0-9]{20,30}\b/g, '<id>') // cuid
    .replace(/\b[0-9a-f]{12,}\b/gi, '<hex>')
    .replace(/(["'`])(?:(?!\1).){1,200}\1/g, '$1…$1')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE);
}

/** A path fit to keep: no query string, no token-looking segments. */
export function safePath(path: string | null | undefined): string | null {
  if (!path) return null;
  let pathname = path;
  try {
    pathname = new URL(path, 'http://x').pathname;
  } catch {
    pathname = path.split(/[?#]/)[0];
  }
  return (
    pathname
      .split('/')
      .map((segment) => (segment.length >= 20 && /^[A-Za-z0-9_-]+$/.test(segment) ? ':token' : segment))
      .join('/')
      .slice(0, 300) || '/'
  );
}

/** A browser path turned into a place: ids and numbers become ":id", so every order page is one place. */
export function placeOf(path: string | null | undefined): string {
  const safe = safePath(path) ?? '/';
  return safe
    .split('/')
    .map((segment) =>
      segment === ':token' || /^\d+$/.test(segment) || /^c[a-z0-9]{20,30}$/.test(segment) || /^[0-9a-f-]{16,}$/i.test(segment) ? ':id' : segment,
    )
    .join('/');
}

export function fingerprintOf(source: string, where: string, message: string): string {
  return createHash('sha256').update(`${source}\n${where}\n${normalizeMessage(message)}`).digest('hex').slice(0, 32);
}

/*
 * Browser noise that says nothing about our code: an extension, a flaky
 * connection, a tab left open across a deploy, a cross-origin script hiding
 * its message. Dropped before it's stored.
 */
const BROWSER_NOISE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /Failed to fetch/i,
  /NetworkError when attempting to fetch/i,
  /^Load failed$/i,
  /Loading chunk [\w-]+ failed/i,
  /ChunkLoadError/i,
  /Failed to load resource/i,
  /The operation was aborted/i,
  /AbortError/i,
  /chrome-extension:\/\/|moz-extension:\/\/|safari-web-extension:\/\//i,
];

export function isBrowserNoise(message: string, stack?: string | null): boolean {
  return BROWSER_NOISE.some((pattern) => pattern.test(message.trim()) || (stack ? pattern.test(stack) : false));
}

/*
 * Server "errors" that are how Next.js works, not failures: notFound(),
 * redirect(), and a page opting into dynamic rendering.
 */
export function isNextControlFlow(error: { message?: string; digest?: string }): boolean {
  const digest = error.digest ?? '';
  return (
    digest.startsWith('NEXT_') ||
    digest === 'DYNAMIC_SERVER_USAGE' ||
    digest === 'BAILOUT_TO_CLIENT_SIDE_RENDERING' ||
    /^NEXT_(NOT_FOUND|REDIRECT|HTTP_ERROR_FALLBACK)/.test(error.message ?? '')
  );
}
