/*
 * Search by image, end to end against the real database (Postgres + pgvector).
 *
 * The only thing faked is the embedding model: a stand-in maps an image to a
 * known unit vector (by one byte of it), so similarities are exact and no
 * test spends a Gemini call. Everything else is real — the vector SQL, the
 * tenant filter inside it, the catalogue's visibility rules, the indexing
 * worker, the cascades — because those are what this feature must get right.
 *
 * The headline guarantees:
 *   • a photo that is a PERFECT match for store B's product, searched in
 *     store A, still returns nothing of store B's;
 *   • the store is the host's (x-org-slug), never a field the client posts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => ({ slug: '', ip: '203.0.113.1' }));
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'x-org-slug': request.slug, 'x-forwarded-for': request.ip }),
  cookies: async () => ({ get: () => undefined }),
}));

import { prisma } from '@/lib/prisma';
import { setImageEmbedder, type ImageEmbedder } from '@/lib/storefront/visual-search/embedding';
import { EmbeddingError } from '@/lib/storefront/visual-search/embedding';
import { visualSearchConfig } from '@/lib/storefront/visual-search/config';
import {
  indexPendingImages,
  productImageSearchStatus,
  requeueProductImages,
  syncProductImageEmbeddings,
} from '@/lib/storefront/visual-search/indexing';
import { resetEmbeddingCoolDown } from '@/lib/storefront/visual-search/quota';
import { startImageSearch, visualSearchProducts } from '@/lib/storefront/visual-search/service';
import { loadQueryVector, writeImageEmbedding } from '@/lib/storefront/visual-search/vector-store';
import { searchByImageAction } from '@/features/shop-visual-search/actions';

/* The catalogue must read the database, not the demo fixtures. */
const fixturesWere = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const storeA = { id: '', slug: `__test-vsearch-a-${suffix}` };
const storeB = { id: '', slug: `__test-vsearch-b-${suffix}` };
const MODEL = visualSearchConfig().model;
const DIMS = visualSearchConfig().dimensions;

/* ─────────────────────────── the fake model ──────────────────────────── */

/** Unit vector along one axis. Distinct axes → similarity 0; same axis → 1. */
const axis = (i: number) => Array.from({ length: DIMS }, (_, k) => (k === i ? 1 : 0));

/** A fake JPEG whose byte 4 names the axis the fake model maps it to. */
const photo = (seed: number, size = 2048) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, seed]);
  return bytes;
};
const photoFile = (seed: number) => new Blob([photo(seed) as BlobPart], { type: 'image/jpeg' });

const embedImage = vi.fn(async (image: { bytes: Uint8Array }) => axis(image.bytes[4]));
const fakeEmbedder: ImageEmbedder = {
  id: 'fake',
  model: MODEL,
  dimensions: DIMS,
  configured: () => true,
  embedImage: (image) => embedImage(image),
};

/* Cloudinary image downloads, answered with fake JPEGs by URL. */
const imageBytes = new Map<string, Uint8Array>();
const fetchMock = vi.fn(async (url: string | URL | Request) => {
  const key = [...imageBytes.keys()].find((k) => String(url).endsWith(k));
  if (!key) return new Response('missing', { status: 404 });
  return new Response(imageBytes.get(key)! as BodyInit, { status: 200, headers: { 'content-type': 'image/jpeg' } });
});
const cloudinaryUrl = (name: string) => `https://res.cloudinary.com/demo/image/upload/v1/tests/${name}.jpg`;

/* ─────────────────────────── the stores ──────────────────────────────── */

async function sellableProduct(organizationId: string, name: string, opts: { published?: boolean } = {}) {
  const warehouse = await prisma.warehouse.create({
    data: { organizationId, name: `${name} Store`, sellsOnline: true, status: 'ACTIVE' },
  });
  const item = await prisma.inventoryItem.create({
    data: {
      organizationId,
      name,
      sku: `${name}-${suffix}`.slice(0, 40),
      slug: `${name.toLowerCase()}-${suffix}`.slice(0, 60),
      sellingPrice: 5000,
      isPublished: opts.published ?? true,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  await prisma.inventoryLevel.create({ data: { inventoryItemId: item.id, warehouseId: warehouse.id, quantity: 10 } });
  return item.id;
}

async function addImage(organizationId: string, productId: string, name: string, sortOrder = 0) {
  return prisma.productImage.create({
    data: { organizationId, inventoryItemId: productId, url: cloudinaryUrl(name), sortOrder },
    select: { id: true },
  });
}

/** An image with an embedding already stored — what indexing leaves behind. */
async function indexedImage(organizationId: string, productId: string, name: string, vectorAxis: number) {
  const image = await addImage(organizationId, productId, name);
  await syncProductImageEmbeddings(organizationId, productId);
  const row = await prisma.productImageEmbedding.findUniqueOrThrow({ where: { productImageId: image.id } });
  await writeImageEmbedding({ embeddingId: row.id, vector: axis(vectorAxis), model: MODEL, sourceHash: `hash-${name}` });
  return image.id;
}

const ids = { a1: '', a2: '', aHidden: '', b1: '', bTwin: '' };

beforeAll(async () => {
  storeA.id = (await prisma.organization.create({ data: { name: 'Store A', slug: storeA.slug } })).id;
  storeB.id = (await prisma.organization.create({ data: { name: 'Store B', slug: storeB.slug } })).id;

  ids.a1 = await sellableProduct(storeA.id, 'RedDress');
  ids.a2 = await sellableProduct(storeA.id, 'BlueBag');
  ids.aHidden = await sellableProduct(storeA.id, 'Unpublished', { published: false });
  ids.b1 = await sellableProduct(storeB.id, 'BStoreBoot');
  ids.bTwin = await sellableProduct(storeB.id, 'BStoreDressTwin');

  await indexedImage(storeA.id, ids.a1, `a1-${suffix}`, 1);
  await indexedImage(storeA.id, ids.a2, `a2-${suffix}`, 2);
  await indexedImage(storeA.id, ids.aHidden, `ahidden-${suffix}`, 1); // same look as a1, but unpublished
  await indexedImage(storeB.id, ids.b1, `b1-${suffix}`, 5); // a look only store B has
  await indexedImage(storeB.id, ids.bTwin, `btwin-${suffix}`, 1); // identical to store A's dress
}, 120_000); // many round trips to a remote database

beforeEach(() => {
  setImageEmbedder(fakeEmbedder);
  embedImage.mockClear();
  fetchMock.mockClear();
  resetEmbeddingCoolDown();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('GEMINI_EMBED_MAX_RPM', '10000');
  vi.stubEnv('GEMINI_EMBED_MAX_RPD', '10000');
  vi.stubEnv('GEMINI_EMBED_STORE_MAX_RPM', '10000');
  vi.stubEnv('GEMINI_EMBED_STORE_MAX_RPD', '10000');
  vi.stubEnv('GEMINI_EMBED_INDEX_MAX_RPM', '10000');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  setImageEmbedder(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (fixturesWere === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWere;
  for (const org of [storeA, storeB]) {
    await prisma.$executeRaw`DELETE FROM visual_search_queries WHERE "organizationId" = ${org.id}`;
    await prisma.productImageEmbedding.deleteMany({ where: { organizationId: org.id } });
    await prisma.productImage.deleteMany({ where: { organizationId: org.id } });
    await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId: org.id } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId: org.id } });
    await prisma.warehouse.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}, 120_000);

let ipCounter = 10;
/** A fresh shopper per call, so request limits don't leak between tests. */
const shopper = () => ({ ip: `198.51.100.${ipCounter++}` });

async function searchIn(store: { slug: string }, seed: number) {
  const started = await startImageSearch({ store: { organizationSlug: store.slug }, file: photoFile(seed), who: shopper() });
  if (!started.ok) throw new Error(`search failed: ${started.code}`);
  return {
    queryId: started.queryId,
    response: await visualSearchProducts({
      store: { organizationSlug: store.slug },
      source: { kind: 'query', queryId: started.queryId },
    }),
  };
}

/* ─────────────────────────── tenant isolation ────────────────────────── */

describe('tenant isolation', () => {
  it('store A never returns store B’s products — even for a perfect match of B’s photo', async () => {
    const { response } = await searchIn(storeA, 5); // exactly store B's boot
    expect(response.products.map((p) => p.id)).not.toContain(ids.b1);
    expect(response.products).toEqual([]);
  });

  it('when both stores have an identical photo, each only sees its own product', async () => {
    const inA = (await searchIn(storeA, 1)).response.products.map((p) => p.id);
    const inB = (await searchIn(storeB, 1)).response.products.map((p) => p.id);
    expect(inA).toEqual([ids.a1]);
    expect(inB).toEqual([ids.bTwin]);
  });

  it('the store is the host’s, not anything the client posts', async () => {
    request.slug = storeA.slug;
    request.ip = '192.0.2.50';
    const form = new FormData();
    form.append('image', photoFile(5), 'search.jpg');
    // A client trying to steer the search at store B:
    form.append('org', storeB.slug);
    form.append('organizationId', storeB.id);
    form.append('storeId', storeB.id);

    const result = await searchByImageAction(form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await loadQueryVector(storeA.id, result.queryId)).not.toBeNull();
    expect(await loadQueryVector(storeB.id, result.queryId)).toBeNull();
    const response = await visualSearchProducts({
      store: { organizationSlug: storeA.slug },
      source: { kind: 'query', queryId: result.queryId },
    });
    expect(response.products.map((p) => p.id)).not.toContain(ids.b1);
  });

  it('a query id from store A is useless on store B’s page', async () => {
    const { queryId } = await searchIn(storeA, 1);
    await expect(
      visualSearchProducts({ store: { organizationSlug: storeB.slug }, source: { kind: 'query', queryId } }),
    ).rejects.toMatchObject({ code: 'expired' });
  });

  it('"find similar" with another store’s product id is a broken link, not a peek', async () => {
    await expect(
      visualSearchProducts({ store: { organizationSlug: storeA.slug }, source: { kind: 'product', productId: ids.b1 } }),
    ).rejects.toMatchObject({ code: 'invalid_source' });
  });

  it('without a store resolved from the host, the action refuses', async () => {
    request.slug = '';
    const form = new FormData();
    form.append('image', photoFile(1), 'search.jpg');
    expect(await searchByImageAction(form)).toMatchObject({ ok: false });
    expect(embedImage).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────── search results ──────────────────────────── */

describe('search results', () => {
  it('ranks the store’s most similar product first, as a real catalogue row', async () => {
    const { response } = await searchIn(storeA, 2);
    expect(response.products[0].id).toBe(ids.a2);
    expect(response.products[0].name).toBe('BlueBag');
    expect(response.products[0].slug).toMatch(/^bluebag-/);
    expect(response.confidence).toBe('high');
  });

  it('never shows an unpublished product, however close its photo', async () => {
    const { response } = await searchIn(storeA, 1);
    expect(response.products.map((p) => p.id)).toEqual([ids.a1]);
    expect(response.products.map((p) => p.id)).not.toContain(ids.aHidden);
  });

  it('answers an unrelated photo with no matches, not an error', async () => {
    const { response } = await searchIn(storeA, 300);
    expect(response.matches).toEqual([]);
    expect(response.total).toBe(0);
  });

  it('"find similar" uses the stored vector — no model call — and leaves the product itself out', async () => {
    const response = await visualSearchProducts({
      store: { organizationSlug: storeA.slug },
      source: { kind: 'product', productId: ids.a1 },
    });
    expect(embedImage).not.toHaveBeenCalled();
    expect(response.products.map((p) => p.id)).not.toContain(ids.a1);
  });
});

/* ─────────────────────────── image lifecycle ─────────────────────────── */

describe('product image changes', () => {
  it('a deleted image takes its embedding with it, so it can never match again', async () => {
    const product = await sellableProduct(storeA.id, 'GreenHat');
    const imageId = await indexedImage(storeA.id, product, `hat-${suffix}`, 7);
    expect((await searchIn(storeA, 7)).response.products.map((p) => p.id)).toEqual([product]);

    await prisma.productImage.delete({ where: { id: imageId } });
    expect(await prisma.productImageEmbedding.count({ where: { productImageId: imageId } })).toBe(0);
    expect((await searchIn(storeA, 7)).response.products).toEqual([]);
  });

  it('a deleted product disappears from results with its embeddings', async () => {
    const product = await sellableProduct(storeA.id, 'OldLamp');
    await indexedImage(storeA.id, product, `lamp-${suffix}`, 8);
    await prisma.inventoryLevel.deleteMany({ where: { inventoryItemId: product } });
    await prisma.inventoryItem.delete({ where: { id: product } });

    expect(await prisma.productImageEmbedding.count({ where: { inventoryItemId: product } })).toBe(0);
    expect((await searchIn(storeA, 8)).response.products).toEqual([]);
  });

  it('queues only new images; an unchanged image is never queued again', async () => {
    const product = await sellableProduct(storeA.id, 'Scarf');
    await addImage(storeA.id, product, `scarf-${suffix}`);
    expect(await syncProductImageEmbeddings(storeA.id, product)).toBe(1);
    expect(await syncProductImageEmbeddings(storeA.id, product)).toBe(0);

    await addImage(storeA.id, product, `scarf-back-${suffix}`, 1);
    expect(await syncProductImageEmbeddings(storeA.id, product)).toBe(1);
  });

  it('embeds a new image once, and reuses the vector for identical bytes instead of paying again', async () => {
    const product = await sellableProduct(storeA.id, 'Belt');
    const first = `belt-${suffix}`;
    const copy = `belt-copy-${suffix}`;
    imageBytes.set(`${first}.jpg`, photo(9));
    imageBytes.set(`${copy}.jpg`, photo(9)); // the same photo uploaded twice

    await addImage(storeA.id, product, first);
    await syncProductImageEmbeddings(storeA.id, product);
    expect(await indexPendingImages({ organizationId: storeA.id, productId: product })).toMatchObject({ indexed: 1 });
    expect(embedImage).toHaveBeenCalledTimes(1);

    await addImage(storeA.id, product, copy, 1);
    await syncProductImageEmbeddings(storeA.id, product);
    expect(await indexPendingImages({ organizationId: storeA.id, productId: product })).toMatchObject({ reused: 1, indexed: 0 });
    expect(embedImage).toHaveBeenCalledTimes(1);

    // Indexed and searchable, with no further model call at search time beyond the shopper's own photo.
    expect(await productImageSearchStatus(storeA.id, product)).toMatchObject({ images: 2, indexed: 2 });
    expect((await searchIn(storeA, 9)).response.products.map((p) => p.id)).toEqual([product]);
  });

  it('refuses to fetch anything but a Cloudinary upload (no server-side request to arbitrary URLs)', async () => {
    const product = await sellableProduct(storeA.id, 'Sock');
    const image = await prisma.productImage.create({
      data: { organizationId: storeA.id, inventoryItemId: product, url: 'http://169.254.169.254/latest/meta-data', sortOrder: 0 },
    });
    await syncProductImageEmbeddings(storeA.id, product);
    expect(await indexPendingImages({ organizationId: storeA.id, productId: product })).toMatchObject({ failed: 1 });

    const row = await prisma.productImageEmbedding.findUniqueOrThrow({ where: { productImageId: image.id } });
    expect(row.status).toBe('FAILED');
    expect(row.nextAttemptAt).toBeNull(); // permanent — not retried
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────── failures ────────────────────────────────── */

describe('when things go wrong', () => {
  it('a store with nothing indexed is told so, without spending a model call', async () => {
    const empty = { slug: `__test-vsearch-empty-${suffix}` };
    const org = await prisma.organization.create({ data: { name: 'Empty', slug: empty.slug } });
    try {
      const result = await startImageSearch({ store: { organizationSlug: empty.slug }, file: photoFile(1), who: shopper() });
      expect(result).toMatchObject({ ok: false, code: 'not_ready' });
      expect(embedImage).not.toHaveBeenCalled();
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it('an invalid upload is refused before the model is called', async () => {
    const svg = new Blob([new TextEncoder().encode('<svg/>'.repeat(50)) as BlobPart], { type: 'image/jpeg' });
    const result = await startImageSearch({ store: { organizationSlug: storeA.slug }, file: svg, who: shopper() });
    expect(result).toMatchObject({ ok: false, code: 'invalid_image' });
    expect(embedImage).not.toHaveBeenCalled();
  });

  it('a Gemini 429 becomes "busy", and pauses further calls instead of hammering the quota', async () => {
    embedImage.mockRejectedValueOnce(new EmbeddingError('rate_limited', 'Gemini 429', 429, 30_000));
    const first = await startImageSearch({ store: { organizationSlug: storeA.slug }, file: photoFile(1), who: shopper() });
    expect(first).toMatchObject({ ok: false, code: 'busy' });
    expect(first.ok ? '' : first.message).not.toMatch(/gemini|429|quota|api/i);

    const second = await startImageSearch({ store: { organizationSlug: storeA.slug }, file: photoFile(1), who: shopper() });
    expect(second).toMatchObject({ ok: false, code: 'busy' });
    expect(embedImage).toHaveBeenCalledTimes(1);
  });

  it('a Gemini outage becomes a friendly "unavailable"', async () => {
    embedImage.mockRejectedValueOnce(new EmbeddingError('unavailable', 'Gemini 503', 503));
    const result = await startImageSearch({ store: { organizationSlug: storeA.slug }, file: photoFile(1), who: shopper() });
    expect(result).toMatchObject({ ok: false, code: 'unavailable' });
    expect(result.ok ? '' : result.message).not.toMatch(/gemini|503/i);
  });

  it('indexing through a 429 leaves the image waiting, not failed', async () => {
    const product = await sellableProduct(storeA.id, 'Glove');
    const name = `glove-${suffix}`;
    imageBytes.set(`${name}.jpg`, photo(11));
    const image = await addImage(storeA.id, product, name);
    await syncProductImageEmbeddings(storeA.id, product);

    embedImage.mockRejectedValueOnce(new EmbeddingError('rate_limited', 'Gemini 429', 429));
    expect(await indexPendingImages({ organizationId: storeA.id, productId: product })).toMatchObject({ deferred: 1 });
    const row = await prisma.productImageEmbedding.findUniqueOrThrow({ where: { productImageId: image.id } });
    expect(row.status).toBe('PENDING');
    expect(row.attempts).toBe(0);
  });

  it('a failed image is retried later with backoff, and "Try again" requeues it', async () => {
    const product = await sellableProduct(storeA.id, 'Cap');
    const image = await addImage(storeA.id, product, `cap-missing-${suffix}`); // 404 from the fake CDN
    await syncProductImageEmbeddings(storeA.id, product);

    expect(await indexPendingImages({ organizationId: storeA.id, productId: product })).toMatchObject({ failed: 1 });
    let row = await prisma.productImageEmbedding.findUniqueOrThrow({ where: { productImageId: image.id } });
    expect(row).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    expect(await requeueProductImages(storeA.id, product)).toBe(1);
    row = await prisma.productImageEmbedding.findUniqueOrThrow({ where: { productImageId: image.id } });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 0 });
  });

  it('"Try again" for another store’s product changes nothing', async () => {
    expect(await requeueProductImages(storeB.id, ids.a1)).toBe(0);
    expect(await prisma.productImageEmbedding.count({ where: { organizationId: storeB.id, inventoryItemId: ids.a1 } })).toBe(0);
  });
});

/* ─────────────────────────── rate limiting ───────────────────────────── */

describe('rate limiting', () => {
  it('stops one shopper uploading over and over, without affecting other stores', async () => {
    const who = { ip: '192.0.2.99' };
    const results = [];
    for (let i = 0; i < 15; i++) {
      results.push(await startImageSearch({ store: { organizationSlug: storeA.slug }, file: photoFile(1), who }));
    }
    const limited = results.find((r) => !r.ok && r.code === 'rate_limited');
    expect(limited).toBeDefined();
    // Every call after the limit is refused before the model is asked.
    expect(embedImage.mock.calls.length).toBeLessThan(15);

    const elsewhere = await startImageSearch({ store: { organizationSlug: storeB.slug }, file: photoFile(1), who });
    expect(elsewhere.ok).toBe(true);
  });
});
