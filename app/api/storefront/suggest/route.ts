/*
 * Search-as-you-type suggestions for the storefront header overlay.
 *
 * Lives at the top level (not under app/store/[organizationSlug]) because
 * proxy.ts's matcher deliberately excludes `/api` — storefront API routes
 * never receive the tenant rewrite. The caller therefore names its store
 * (`?store=`), and that slug is the only scope this route trusts.
 */
import { NextResponse } from 'next/server';
import { getSearchSuggestions } from '@/lib/storefront/catalog';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = params.get('q')?.trim() ?? '';
  const organizationSlug = params.get('store')?.trim() ?? '';

  if (!organizationSlug) {
    return NextResponse.json({ error: 'Missing store' }, { status: 400 });
  }
  if (q.length < 2) {
    return NextResponse.json({ products: [], categories: [], brands: [], terms: [] });
  }

  const { products, categories, brands, terms } = await getSearchSuggestions(q, {
    store: { organizationSlug },
  });

  return NextResponse.json({
    products: products.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      brand: p.brandName,
      image: p.images[0]?.url ?? '',
      priceFrom: p.priceFrom,
      currency: p.currency,
    })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, path: c.path })),
    brands: brands.map((b) => ({ id: b.id, name: b.name, slug: b.slug })),
    terms,
  });
}
