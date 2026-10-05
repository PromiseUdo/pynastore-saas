/*
 * lib/mobile/deep-link.ts
 *
 * Reading a deep link the app was opened with (`appUrlOpen`). Safe anywhere.
 *
 * The scheme is the app's own id (ROADMAP 16.1) and differs from one store's
 * app to the next, so links are recognised by their host — `payment-return`,
 * `auth-return` — never by the scheme: any link the OS delivers to this app
 * was addressed to it.
 */
export interface AppDeepLink {
  host: string;
  params: URLSearchParams;
}

export function parseAppDeepLink(url: string): AppDeepLink | null {
  const match = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)[^?#]*(?:\?([^#]*))?/i);
  if (!match) return null;
  return { host: match[1].toLowerCase(), params: new URLSearchParams(match[2] ?? '') };
}
