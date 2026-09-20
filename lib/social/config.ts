/*
 * lib/social/config.ts
 *
 * The one place the Meta callback URL is decided.
 *
 * It has to be identical in two places — the authorization request and the
 * code exchange — because Meta compares them and rejects the exchange if
 * they differ by so much as a trailing slash. Computing it twice is how that
 * bug happens, so it is computed here and imported by both.
 *
 * META_REDIRECT_URI wins when set. That is how a tunnel, a staging host or a
 * production domain is pointed at without a code change: whatever is
 * registered in the Meta app's "Valid OAuth Redirect URIs" goes here
 * verbatim. Nothing about that host is assumed or invented.
 *
 * The fallback is the marketing (root) origin, NOT a tenant subdomain: Meta
 * allows no wildcard in a redirect URI, so one registered URL has to serve
 * every merchant. The store travels in the signed state instead — see
 * lib/social/state.ts.
 */
import { getRootDomain, isLocalHostname } from '@/lib/tenant/resolveHostname';

export function metaRedirectUri(): string {
  const configured = process.env.META_REDIRECT_URI?.trim();
  if (configured) return configured;

  const root = getRootDomain();
  const protocol = isLocalHostname(root) ? 'http' : 'https';
  return `${protocol}://${root}/api/social/meta/callback`;
}
