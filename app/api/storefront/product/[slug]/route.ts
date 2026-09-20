/*
 * Single product payload for the quick-view modal (and any other
 * client-side product lookups). Top-level for the same reason as
 * /api/storefront/suggest — proxy.ts skips /api — so the caller names its
 * store and that slug is the only scope this route trusts.
 */
import { NextResponse } from 'next/server';
import { getProductBySlug } from '@/lib/storefront/catalog';

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const organizationSlug = new URL(request.url).searchParams.get('store')?.trim() ?? '';
  if (!organizationSlug) return NextResponse.json({ error: 'Missing store' }, { status: 400 });

  const product = await getProductBySlug(slug, { organizationSlug });
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ product });
}
