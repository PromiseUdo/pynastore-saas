/*
 * lib/storefront/account/google-link.ts
 *
 * Builds the "Continue with Google" link for a store's auth pages.
 *
 * The link leaves this origin for the OAuth origin on purpose (see
 * ./google.ts), so it carries an absolute `returnTo` — where the shopper
 * should end up once the round trip is done. That URL is built from the host
 * the request actually arrived on, which is the only way to get it right for
 * a merchant's custom domain, and it is re-validated on the way back in.
 *
 * On the mobile origin the public URL keeps a /s/{slug} prefix that the
 * internal route has already lost, so the prefix is put back here.
 */
import { headers } from 'next/headers';
import { oauthOrigin } from './google';
import { isLocalHostname } from '@/lib/tenant/resolveHostname';

export async function googleStartHref(input: { slug: string; next: string }): Promise<string> {
  const headerList = await headers();
  const host = headerList.get('host') ?? '';
  const isMobileRuntime = headerList.get('x-runtime') === 'mobile';

  const protocol = isLocalHostname(host) || process.env.NODE_ENV !== 'production' ? 'http' : 'https';
  const publicPath = isMobileRuntime
    ? `/s/${input.slug}${input.next === '/' ? '' : input.next}`
    : input.next;

  const url = new URL('/api/storefront/auth/google/start', oauthOrigin());
  url.searchParams.set('slug', input.slug);
  url.searchParams.set('next', input.next);
  url.searchParams.set('returnTo', `${protocol}://${host}${publicPath}`);

  return url.toString();
}
