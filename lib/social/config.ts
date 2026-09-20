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
 * The fallback is the platform origin (NEXT_PUBLIC_PLATFORM_HOST, e.g.
 * app.getnotely.io), NOT a tenant subdomain and not the apex: Meta allows no
 * wildcard in a redirect URI, so one registered URL has to serve every
 * merchant. The store travels in the signed state instead — see
 * lib/social/state.ts.
 */
import { getMarketingUrl } from '@/lib/tenant/urls';

export function metaRedirectUri(): string {
  const configured = process.env.META_REDIRECT_URI?.trim();
  if (configured) return configured;

  return getMarketingUrl('/api/social/meta/callback');
}
