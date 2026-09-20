/*
 * Which store a storefront API call operates on — discover, the assistant
 * and recommendations — against the real database and the real catalogue.
 *
 * Two stores, each with one product whose name only it has ("Alpha Lantern"
 * in A, "Bravo Lantern" in B). Every response is checked for the OTHER
 * store's product, so a leak can't hide behind an empty result.
 *
 *   store hosts   the hostname is the store; a body `org` naming another
 *                 store is refused (403)
 *   mobile mall   one host for every store; the store is the /s/{slug} page
 *                 the call came from, and /s/A → /s/B browsing still works
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST as discover } from '@/app/api/storefront/discover/route';
import { POST as assistant } from '@/app/api/storefront/assistant/route';
import { POST as recommendations } from '@/app/api/storefront/recommendations/route';
import { resolveRequestStore } from '@/lib/storefront/request-store';
import {
  MOBILE_DOMAIN,
  ROOT_DOMAIN,
  createTestStores,
  mobileRequest,
  pinDomains,
  storefrontRequest,
} from './helpers/storefront-requests';

pinDomains();
/* The real catalogue, not the demo fixtures — isolation is about real rows. */
const fixturesWere = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const A = { id: '', slug: '', productId: '' };
const B = { id: '', slug: '', productId: '' };
let cleanupStores = async () => {};

async function sellable(organizationId: string, name: string, suffix: string) {
  const warehouse = await prisma.warehouse.create({
    data: { organizationId, name: `${name} Store`, sellsOnline: true, status: 'ACTIVE' },
  });
  const item = await prisma.inventoryItem.create({
    data: {
      organizationId,
      name,
      sku: `${name}-${suffix}`.replace(/\s+/g, '-').slice(0, 40),
      slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${suffix}`.slice(0, 60),
      sellingPrice: 5000,
      isPublished: true,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  await prisma.inventoryLevel.create({ data: { inventoryItemId: item.id, warehouseId: warehouse.id, quantity: 10 } });
  return item.id;
}

beforeAll(async () => {
  const made = await createTestStores('tenancy', 2);
  cleanupStores = made.cleanup;
  const suffix = Math.random().toString(36).slice(2, 8);
  Object.assign(A, made.stores[0]);
  Object.assign(B, made.stores[1]);
  A.productId = await sellable(A.id, 'Alpha Lantern', suffix);
  B.productId = await sellable(B.id, 'Bravo Lantern', suffix);
}, 120_000);

afterAll(async () => {
  if (fixturesWere === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWere;
  for (const store of [A, B]) {
    await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId: store.id } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId: store.id } });
    await prisma.warehouse.deleteMany({ where: { organizationId: store.id } });
  }
  await cleanupStores();
}, 120_000);

let ip = 1;
const fresh = () => ({ 'x-forwarded-for': `198.18.0.${ip++}` });

/** Every product id anywhere in a response body. */
const productIds = (body: unknown): string[] => {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.id === 'string' && typeof o.slug === 'string' && 'priceFrom' in o) out.push(o.id);
      Object.values(o).forEach(walk);
    }
  };
  walk(body);
  return out;
};

/* ─────────────────────────────── discover ────────────────────────────── */

describe('discover', () => {
  const PATH = '/api/storefront/discover';

  it('answers from the store whose domain the request came to', async () => {
    const res = await discover(storefrontRequest(A.slug, PATH, { q: 'lantern' }, fresh()));
    expect(res.status).toBe(200);
    const ids = productIds(await res.json());
    expect(ids).toContain(A.productId);
    expect(ids).not.toContain(B.productId);
  });

  it('refuses a forged org naming another store, and returns none of its catalogue', async () => {
    const res = await discover(storefrontRequest(A.slug, PATH, { org: B.slug, q: 'lantern' }, fresh()));
    expect(res.status).toBe(403);
    expect(productIds(await res.json())).toEqual([]);
  });

  it('accepts an org that matches the domain (older clients)', async () => {
    const res = await discover(storefrontRequest(A.slug, PATH, { org: A.slug, q: 'lantern' }, fresh()));
    expect(res.status).toBe(200);
  });

  it('answers an unknown store with 404', async () => {
    const res = await discover(storefrontRequest('no-such-store-anywhere', PATH, { q: 'lantern' }, fresh()));
    expect(res.status).toBe(404);
  });

  it('refuses calls from the admin or marketing site', async () => {
    for (const host of [`${A.slug}.${ROOT_DOMAIN}`, ROOT_DOMAIN]) {
      const res = await discover(
        new Request(`http://${host}${PATH}`, {
          method: 'POST',
          headers: { host, 'content-type': 'application/json', ...fresh() },
          body: JSON.stringify({ org: A.slug, q: 'lantern' }),
        }),
      );
      expect(res.status).toBe(400);
    }
  });
});

/* ─────────────────────────────── assistant ───────────────────────────── */

describe('assistant', () => {
  const PATH = '/api/storefront/assistant';

  it('works from the store’s own domain, with only its products', async () => {
    const res = await assistant(storefrontRequest(A.slug, PATH, { message: 'show me lanterns' }, fresh()));
    expect(res.status).toBe(200);
    const ids = productIds(await res.json());
    expect(ids).toContain(A.productId);
    expect(ids).not.toContain(B.productId);
  });

  it('refuses a forged org naming another store', async () => {
    const res = await assistant(storefrontRequest(A.slug, PATH, { org: B.slug, message: 'show me lanterns' }, fresh()));
    expect(res.status).toBe(403);
    expect(productIds(await res.json())).toEqual([]);
  });

  it('can’t reach another store’s product through a product id either', async () => {
    const res = await assistant(
      storefrontRequest(A.slug, PATH, { message: 'is this good?', context: { productId: B.productId } }, fresh()),
    );
    expect(res.status).toBe(200);
    expect(productIds(await res.json())).not.toContain(B.productId);
  });
});

/* ──────────────────────────── recommendations ────────────────────────── */

describe('recommendations', () => {
  const PATH = '/api/storefront/recommendations';

  it('works from the store’s own domain, with only its products', async () => {
    const res = await recommendations(storefrontRequest(A.slug, PATH, { placement: 'homepage' }, fresh()));
    expect(res.status).toBe(200);
    const ids = productIds(await res.json());
    expect(ids).toContain(A.productId);
    expect(ids).not.toContain(B.productId);
  });

  it('refuses a forged org naming another store', async () => {
    const res = await recommendations(storefrontRequest(A.slug, PATH, { org: B.slug, placement: 'homepage' }, fresh()));
    expect(res.status).toBe(403);
    expect(productIds(await res.json())).toEqual([]);
  });

  it('ignores another store’s product ids sent as signals', async () => {
    const res = await recommendations(
      storefrontRequest(
        A.slug,
        PATH,
        { placement: 'homepage', context: { signals: { recentlyViewedIds: [B.productId], cartIds: [B.productId] } } },
        fresh(),
      ),
    );
    expect(res.status).toBe(200);
    expect(productIds(await res.json())).not.toContain(B.productId);
  });
});

/* ─────────────────────────────── mobile mall ─────────────────────────── */

describe('mobile mall', () => {
  it('/s/store-a reaches store A and /s/store-b reaches store B, on the same host', async () => {
    const inA = await discover(mobileRequest(A.slug, '/api/storefront/discover', { org: A.slug, q: 'lantern' }, fresh()));
    const inB = await discover(mobileRequest(B.slug, '/api/storefront/discover', { org: B.slug, q: 'lantern' }, fresh()));
    expect(inA.status).toBe(200);
    expect(inB.status).toBe(200);
    const idsA = productIds(await inA.json());
    const idsB = productIds(await inB.json());
    expect(idsA).toEqual([A.productId]);
    expect(idsB).toEqual([B.productId]);
  });

  it('the page’s store wins: a body naming another store is refused', async () => {
    for (const [route, body] of [
      [discover, { org: B.slug, q: 'lantern' }],
      [assistant, { org: B.slug, message: 'show me lanterns' }],
      [recommendations, { org: B.slug, placement: 'homepage' }],
    ] as const) {
      const res = await route(mobileRequest(A.slug, '/api/storefront/x', body, fresh()));
      expect(res.status).toBe(403);
    }
  });

  it('assistant and recommendations follow the page’s store too', async () => {
    const chat = await assistant(mobileRequest(B.slug, '/api/storefront/assistant', { message: 'show me lanterns' }, fresh()));
    expect(productIds(await chat.json())).not.toContain(A.productId);

    const recs = await recommendations(mobileRequest(B.slug, '/api/storefront/recommendations', { placement: 'homepage' }, fresh()));
    const ids = productIds(await recs.json());
    expect(ids).toContain(B.productId);
    expect(ids).not.toContain(A.productId);
  });

  it('without a Referer, the claimed store is used only if mobile routing would serve it', async () => {
    const res = await discover(mobileRequest(null, '/api/storefront/discover', { org: B.slug, q: 'lantern' }, fresh()));
    expect(res.status).toBe(200);
    expect(productIds(await res.json())).toEqual([B.productId]);

    // …and names no store at all → refused, not guessed.
    expect((await discover(mobileRequest(null, '/api/storefront/discover', { q: 'lantern' }, fresh()))).status).toBe(400);
    // …an unknown store → 404.
    expect(
      (await discover(mobileRequest(null, '/api/storefront/discover', { org: 'no-such-store-anywhere', q: 'x' }, fresh()))).status,
    ).toBe(404);
  });

  it('a Referer from another host is not trusted as the page', async () => {
    const forged = new Request(`http://${MOBILE_DOMAIN}/api/storefront/discover`, {
      method: 'POST',
      headers: {
        host: MOBILE_DOMAIN,
        'content-type': 'application/json',
        referer: `http://evil.example/s/${B.slug}/`,
        ...fresh(),
      },
      body: JSON.stringify({ q: 'lantern' }),
    });
    const resolved = await resolveRequestStore(forged, null);
    expect(resolved.ok).toBe(false);
  });
});
