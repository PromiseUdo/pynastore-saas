/*
 * The endpoint contract: what the panel actually posts, and what it refuses.
 *
 * Worth its own test because the route is where the tenant boundary is drawn
 * — the store comes from the request's host (never from the body), and a
 * client-supplied product slug is resolved through that store's catalogue
 * before the provider sees it. Store-selection cases in depth:
 * tests/storefront-api-tenancy.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/storefront/assistant/route';
import { PRODUCTS } from '@/lib/storefront/mock/products';
import { createTestStores, pinDomains, storefrontRequest } from '@/tests/helpers/storefront-requests';

pinDomains();
let acme = '';
let other = '';
let cleanup = async () => {};
beforeAll(async () => {
  const made = await createTestStores('assistant-route', 2);
  [acme, other] = made.stores.map((s) => s.slug);
  cleanup = made.cleanup;
}, 60_000);
afterAll(() => cleanup(), 60_000);

const PATH = '/api/storefront/assistant';
const post = (body: unknown) => POST(storefrontRequest(acme, PATH, body));

describe('POST /api/storefront/assistant', () => {
  it('answers the payload the panel sends', async () => {
    const product = PRODUCTS[0];
    const res = await post({
      org: acme,
      message: 'what is the material?',
      context: { productSlug: product.slug },
      history: [{ role: 'user', text: 'hello' }],
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // The slug was resolved server-side, so the answer is about that row.
    expect(body.products[0].id).toBe(product.id);
    expect(body.intent.task).toBe('product_question');
  });

  it('takes the store from the host — no org field needed', async () => {
    const res = await post({ message: 'show me laptops' });
    expect(res.status).toBe(200);
  });

  it('refuses a request that doesn’t come from a storefront', async () => {
    const res = await POST(
      new Request('http://app.localhost:3000/api/storefront/assistant', {
        method: 'POST',
        headers: { host: 'app.localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({ org: acme, message: 'show me laptops' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a message longer than the cap, rather than paying for it', async () => {
    const res = await post({ org: acme, message: 'a'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const res = await POST(storefrontRequest(acme, PATH, 'not json'));
    expect(res.status).toBe(400);
  });

  it('ignores an unresolvable product slug instead of failing', async () => {
    const res = await post({
      org: acme,
      message: 'show me laptops',
      context: { productSlug: 'a-product-from-another-store' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.products.every((p: { id: string }) => PRODUCTS.some((r) => r.id === p.id))).toBe(true);
  });

  it('rate-limits one shopper with a friendly 429, without touching other stores', async () => {
    const from = (store: string) =>
      POST(storefrontRequest(store, PATH, { message: 'hi' }, { 'x-forwarded-for': '203.0.113.7' }));

    let limited: Response | null = null;
    for (let i = 0; i < 40 && !limited; i++) {
      const res = await from(acme);
      if (res.status === 429) limited = res;
    }
    expect(limited).not.toBeNull();
    expect(limited!.headers.get('retry-after')).toBeTruthy();
    const body = await limited!.json();
    expect(body.error).not.toMatch(/gemini|api|key|stack/i);

    // Same IP, different store: its own bucket.
    expect((await from(other)).status).toBe(200);
  });
});
