'use server';

/*
 * features/shop-visual-search/actions.ts
 *
 * Search by image: the shopper's photo in, a results link out.
 *
 * The form carries ONE field — the image. The store is not in it and would
 * be ignored if it were: it comes from `x-org-slug`, which proxy.ts sets from
 * the request's host (overwriting anything a client sent), exactly as
 * checkout does. So a shopper on store A's domain can only ever search store
 * A, whatever they post.
 *
 * All the work — rate limits, file checks, the embedding call, storing the
 * query — is lib/storefront/visual-search/service.ts. This file only
 * establishes who and where.
 */
import { createHash } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { currentStoreSlug, sessionCookieName } from '@/lib/storefront/account/session';
import { storePathPrefix } from '@/lib/storefront/store-path';
import { startImageSearch } from '@/lib/storefront/visual-search/service';
import { imageSearchHref } from '@/lib/storefront/visual-search/query';

export type ImageSearchActionResult =
  | { ok: true; href: string; queryId: string }
  | { ok: false; message: string };

export async function searchByImageAction(formData: FormData): Promise<ImageSearchActionResult> {
  const slug = await currentStoreSlug();
  if (!slug) return { ok: false, message: 'We couldn’t reach the store. Please refresh and try again.' };

  const result = await startImageSearch({
    store: { organizationSlug: slug },
    file: formData.get('image'),
    who: await searcher(slug),
  });
  if (!result.ok) return { ok: false, message: result.message };

  // On the app's shared mobile origin the page lives under /s/{slug}.
  const prefix = await storePathPrefix(slug);
  return { ok: true, queryId: result.queryId, href: `${prefix}${imageSearchHref(result.queryId)}` };
}

/** Who is searching, for rate limits: the signed-in session (hashed) when there is one, and the IP. */
async function searcher(slug: string): Promise<{ session?: string; ip: string }> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const token = cookieStore.get(sessionCookieName(slug))?.value;
  const forwarded = headerList.get('x-forwarded-for');
  return {
    session: token ? createHash('sha256').update(token).digest('hex').slice(0, 32) : undefined,
    ip: forwarded?.split(',')[0].trim() || headerList.get('x-real-ip') || 'unknown',
  };
}
