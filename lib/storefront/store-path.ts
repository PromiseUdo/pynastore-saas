/*
 * lib/storefront/store-path.ts
 *
 * How the shopper's browser addresses this store's pages. Server only.
 *
 * On a store's own host a page is `/checkout/confirmation`; on the app's
 * shared mobile origin the same page is `/s/{slug}/checkout/confirmation`
 * (proxy.ts marks those requests `x-runtime: mobile`). Anything that hands
 * the browser an absolute-path URL to follow later — a payment return, a
 * deep-link landing — must include that prefix.
 */
import { headers } from 'next/headers';

export async function storePathPrefix(slug: string): Promise<string> {
  try {
    return (await headers()).get('x-runtime') === 'mobile' ? `/s/${slug}` : '';
  } catch {
    return '';
  }
}

export const confirmationPath = (prefix: string, token: string) =>
  `${prefix}/checkout/confirmation?t=${encodeURIComponent(token)}`;
