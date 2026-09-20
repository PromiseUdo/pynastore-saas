/*
 * The discover endpoint contract: a valid search, request validation, and the
 * rate limit. Store selection (forged org, unknown store, the mobile mall) is
 * covered against the real catalogue in tests/storefront-api-tenancy.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/storefront/discover/route';
import { DISCOVERY_LIMITS } from '@/lib/storefront/discovery-quota';
import { createTestStores, pinDomains, storefrontRequest } from '@/tests/helpers/storefront-requests';

pinDomains();
const PATH = '/api/storefront/discover';
let storeA = '';
let storeB = '';
let cleanup = async () => {};

beforeAll(async () => {
  const made = await createTestStores('discover-route', 2);
  [storeA, storeB] = made.stores.map((s) => s.slug);
  cleanup = made.cleanup;
}, 60_000);
afterAll(() => cleanup(), 60_000);

describe('POST /api/storefront/discover', () => {
  it('answers a search from the current store', async () => {
    const res = await POST(storefrontRequest(storeA, PATH, { q: 'laptop under 1.2m' }, { 'x-forwarded-for': '192.0.2.1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.products)).toBe(true);
    expect(body.recognised.some((r: { kind: string }) => r.kind === 'budget')).toBe(true);
  });

  it('rejects malformed input', async () => {
    const res = await POST(storefrontRequest(storeA, PATH, { q: 'x'.repeat(301) }, { 'x-forwarded-for': '192.0.2.2' }));
    expect(res.status).toBe(400);
  });

  it('rate-limits one shopper with a 429 and Retry-After, without touching another store', async () => {
    const ip = { 'x-forwarded-for': '192.0.2.77' };
    const perMinute = DISCOVERY_LIMITS.ipPerMinute.limit;

    let limited: Response | null = null;
    for (let i = 0; i <= perMinute && !limited; i++) {
      const res = await POST(storefrontRequest(storeA, PATH, { q: 'shoes' }, ip));
      if (res.status === 429) limited = res;
    }
    expect(limited).not.toBeNull();
    expect(Number(limited!.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await limited!.json()).error).toMatch(/a little fast/i);

    // Same IP on another store: that store's own bucket.
    expect((await POST(storefrontRequest(storeB, PATH, { q: 'shoes' }, ip))).status).toBe(200);
  }, 120_000);
});
