/*
 * Tenant isolation.
 *
 * The fixture catalogue is one global dataset, so this cannot be tested by
 * asserting that store A's answer omits store B's products — there is no
 * store B yet. What CAN be tested, and is what actually matters, is that the
 * seam is wired: every catalogue read the assistant causes carries the
 * StoreScope from the request, so the day `listProducts` gains
 * `where: { organizationId }` the assistant is scoped without a single
 * change in lib/ai.
 *
 * The catalogue module is mocked only to record the params each call
 * receives; the real implementation still runs underneath, so the assistant
 * behaves normally while being observed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListProductsParams } from '@/lib/storefront/types';

const seen: ListProductsParams[] = [];

vi.mock('@/lib/storefront/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storefront/catalog')>();
  return {
    ...actual,
    listProducts: (params: ListProductsParams = {}) => {
      seen.push(params);
      return actual.listProducts(params);
    },
  };
});

const { PRODUCTS } = await import('@/lib/storefront/mock/products');
const { createMockShoppingProvider } = await import('./mock-provider');
const { createShoppingTools } = await import('./tools');

const provider = createMockShoppingProvider();

/*
 * Reads with no scope at all. Two are legitimate and deliberate:
 * `getStoreCurrency()` and the price-band/example helpers in
 * lib/storefront/discovery.ts ask the catalogue "what does this store trade
 * in" before any scope exists to ask it with. Everything the ASSISTANT does
 * with products must be scoped.
 */
const isProductRead = (params: ListProductsParams) =>
  Boolean(
    params.categoryPath ||
      params.brandSlugs ||
      params.query ||
      params.productIds ||
      params.minPrice != null ||
      params.maxPrice != null,
  );

beforeEach(() => {
  seen.length = 0;
});

describe('tenant isolation', () => {
  it('carries the requesting store into every product read', async () => {
    await provider.ask({
      message: 'show me laptops under ₦1.5m',
      context: { store: { organizationSlug: 'store-a' } },
      history: [],
    });

    const productReads = seen.filter(isProductRead);
    expect(productReads.length).toBeGreaterThan(0);
    for (const params of productReads) {
      expect(params.store).toEqual({ organizationSlug: 'store-a' });
    }
  });

  it('scopes the recommendation rails too', async () => {
    const product = PRODUCTS[0];
    await provider.ask({
      message: 'show me something cheaper',
      context: { store: { organizationSlug: 'store-b' }, productId: product.id },
      history: [],
    });

    const productReads = seen.filter(isProductRead);
    expect(productReads.length).toBeGreaterThan(0);
    for (const params of productReads) {
      expect(params.store).toEqual({ organizationSlug: 'store-b' });
    }
  });

  it('resolves ids sent by the client through the scoped catalogue, not directly', async () => {
    await provider.ask({
      message: 'which one has the best rating?',
      // Ids a client could have forged — they are looked up, never trusted.
      context: {
        store: { organizationSlug: 'store-c' },
        lastProductIds: ['prod_from_another_store', PRODUCTS[1].id],
      },
      history: [],
    });

    const lookups = seen.filter((p) => p.productIds);
    expect(lookups.length).toBeGreaterThan(0);
    for (const params of lookups) {
      expect(params.store).toEqual({ organizationSlug: 'store-c' });
    }
  });

  it('never lets a tool be built without a store', () => {
    const tools = createShoppingTools({ organizationSlug: 'store-d' });
    // The scope is part of the tool surface, so there is no "unscoped mode".
    expect(tools.store).toEqual({ organizationSlug: 'store-d' });
  });
});
