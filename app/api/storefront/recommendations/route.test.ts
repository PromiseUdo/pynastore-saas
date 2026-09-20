/*
 * The recommendations endpoint contract — where the tenant boundary is drawn
 * for session-backed blocks: the store comes from the request's host (never
 * from the body), and everything else in the body is bounded and validated.
 * Store-selection cases in depth: tests/storefront-api-tenancy.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/storefront/recommendations/route';
import { PRODUCTS } from '@/lib/storefront/mock/products';
import { createTestStores, pinDomains, storefrontRequest } from '@/tests/helpers/storefront-requests';

pinDomains();
let acme = '';
let cleanup = async () => {};
beforeAll(async () => {
  const made = await createTestStores('recs-route', 1);
  acme = made.stores[0].slug;
  cleanup = made.cleanup;
}, 60_000);
afterAll(() => cleanup(), 60_000);

const post = (body: unknown) => POST(storefrontRequest(acme, '/api/storefront/recommendations', body));

describe('POST /api/storefront/recommendations', () => {
  it('answers the payload the client hook sends', async () => {
    const laptop = PRODUCTS.find((p) => p.categoryId === 'cat_laptops');
    if (!laptop) throw new Error('fixture: laptop');

    const res = await post({
      org: acme,
      placement: 'cart',
      limit: 4,
      context: { signals: { cartIds: [laptop.id], recentlyViewedIds: [], recentQueries: ['desk'] } },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await res.json();
    expect(body.placement).toBe('cart');
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(4);
    expect(body.items.map((i: { product: { id: string } }) => i.product.id)).not.toContain(laptop.id);
  });

  it('takes the store from the host — no org field needed', async () => {
    expect((await post({ placement: 'homepage' })).status).toBe(200);
  });

  it('rejects an unknown placement', async () => {
    expect((await post({ org: acme, placement: 'checkout' })).status).toBe(400);
  });

  it('rejects oversized signal lists instead of silently processing them', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `prod_${i}`);
    const res = await post({ org: acme, placement: 'homepage', context: { signals: { recentlyViewedIds: ids } } });
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    expect((await post('{not json')).status).toBe(400);
  });
});
