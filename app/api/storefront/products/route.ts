/*
 * Products by id, in the order asked for.
 *
 * Exists for the "recently viewed" rail: those ids live in the browser
 * (lib/storefront/stores/recently-viewed-store.ts) and are only known after
 * hydration, so the server cannot render that rail with the page. One
 * request for the whole list rather than one per product.
 *
 * Top-level under /api for the same reason as the other storefront
 * endpoints — proxy.ts skips /api, so these are not tenant-rewritten. The
 * store scope therefore travels as a query parameter, which is the seam the
 * API repository will read when this stops being fixtures.
 */
import { NextResponse } from 'next/server';
import { getProductsForIds } from '@/lib/storefront/product-detail';

/** Caps the id list so a hand-made request cannot ask for the whole catalogue. */
const MAX_IDS = 24;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ids = (url.searchParams.get('ids') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);

  if (!ids.length) return NextResponse.json({ products: [] });

  const products = await getProductsForIds(ids, {
    organizationSlug: url.searchParams.get('store') ?? '',
  });

  return NextResponse.json({ products });
}
