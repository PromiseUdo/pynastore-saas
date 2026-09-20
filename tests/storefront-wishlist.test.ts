/*
 * The saved list, against the real database.
 *
 * Two things carry the feature. First, a list belongs to one shopper at one
 * store — a product id from another merchant's catalogue must not be
 * saveable, however it arrives. Second, signing in must never lose a save:
 * the merge folds the browser's list into the account's and keeps both.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { registerShopper } from '@/lib/storefront/account/shopper';
import {
  MAX_WISHLIST,
  addToWishlist,
  listWishlist,
  mergeWishlist,
  removeFromWishlist,
} from '@/lib/storefront/account/wishlist';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-wish-${suffix}` };
const other = { id: '', slug: `__test-wish-other-${suffix}` };

let scope = { organizationId: '', customerId: '' };
let strangerScope = { organizationId: '', customerId: '' };

/** Product ids: three in our store, one in somebody else's. */
const products: string[] = [];
let foreignProduct = '';

async function makeProduct(organizationId: string, name: string): Promise<string> {
  const item = await prisma.inventoryItem.create({
    data: {
      organizationId,
      name,
      sku: `${name}-${suffix}`.slice(0, 40),
      slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${suffix}`.slice(0, 60),
    },
    select: { id: true },
  });
  return item.id;
}

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Wish Store', slug: store.slug } })).id;
  other.id = (await prisma.organization.create({ data: { name: 'Other Store', slug: other.slug } })).id;

  const mine = await registerShopper({
    organizationId: store.id, name: 'Ada Okoro', email: `ada-${suffix}@example.com`, password: 'a password here',
  });
  const stranger = await registerShopper({
    organizationId: other.id, name: 'Someone Else', email: `zed-${suffix}@example.com`, password: 'a password here',
  });
  if (!mine.ok || !stranger.ok) throw new Error('setup failed');

  scope = { organizationId: store.id, customerId: mine.customer.id };
  strangerScope = { organizationId: other.id, customerId: stranger.customer.id };

  for (const name of ['Tote', 'Lamp', 'Kettle']) {
    products.push(await makeProduct(store.id, name));
  }
  foreignProduct = await makeProduct(other.id, 'Foreign');
});

afterAll(async () => {
  for (const org of [store, other]) {
    await prisma.customerWishlistItem.deleteMany({ where: { customer: { organizationId: org.id } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId: org.id } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

describe('saving', () => {
  it('saves a product, newest first', async () => {
    await expect(addToWishlist(scope, products[0])).resolves.toBe(true);
    await expect(addToWishlist(scope, products[1])).resolves.toBe(true);

    await expect(listWishlist(scope)).resolves.toEqual([products[1], products[0]]);
  });

  it('saving the same thing twice is a no-op, not a duplicate', async () => {
    await expect(addToWishlist(scope, products[0])).resolves.toBe(true);
    await expect(listWishlist(scope)).resolves.toHaveLength(2);
  });

  it('refuses a product that belongs to another store', async () => {
    await expect(addToWishlist(scope, foreignProduct)).resolves.toBe(false);
    await expect(addToWishlist(scope, 'not-a-real-id')).resolves.toBe(false);
    await expect(listWishlist(scope)).resolves.toHaveLength(2);
  });

  it('removes only from the list it was asked about', async () => {
    // A stranger naming our product id changes nothing.
    await expect(removeFromWishlist(strangerScope, products[0])).resolves.toBe(false);
    await expect(listWishlist(scope)).resolves.toHaveLength(2);

    await expect(removeFromWishlist(scope, products[0])).resolves.toBe(true);
    await expect(listWishlist(scope)).resolves.toEqual([products[1]]);
  });

  it("shows one shopper nothing of another shopper's list", async () => {
    await expect(listWishlist(strangerScope)).resolves.toEqual([]);
  });
});

describe('merging a guest list on sign-in', () => {
  it('adds what the browser had without removing what the account had', async () => {
    const merged = await mergeWishlist(scope, [products[2], products[1]]);

    expect(merged).toHaveLength(2);
    expect(new Set(merged)).toEqual(new Set([products[1], products[2]]));
  });

  it('ignores ids from another store, and junk', async () => {
    const merged = await mergeWishlist(scope, [foreignProduct, 'nonsense']);
    expect(merged).toHaveLength(2);
  });

  it('is safe to run with nothing to merge', async () => {
    await expect(mergeWishlist(scope, [])).resolves.toHaveLength(2);
  });
});

describe('when a merchant deletes a product', () => {
  it('leaves every list it was on', async () => {
    const doomed = await makeProduct(store.id, 'Doomed');
    await addToWishlist(scope, doomed);
    await expect(listWishlist(scope)).resolves.toContain(doomed);

    await prisma.inventoryItem.delete({ where: { id: doomed } });

    const after = await listWishlist(scope);
    expect(after).not.toContain(doomed);
    // Nobody is left holding a link to nothing.
    expect(after).toHaveLength(2);
  });
});

describe('the cap', () => {
  it('stops a list growing without limit', async () => {
    const existing = await listWishlist(scope);

    // One round trip, not two hundred: the subject here is the cap, and a
    // per-product insert loop against a remote database just times out.
    const needed = MAX_WISHLIST - existing.length;
    await prisma.inventoryItem.createMany({
      data: Array.from({ length: needed }, (_, i) => ({
        organizationId: store.id,
        name: `Filler ${i}`,
        sku: `filler-${i}-${suffix}`,
        slug: `filler-${i}-${suffix}`,
      })),
    });
    const filler = (
      await prisma.inventoryItem.findMany({
        where: { organizationId: store.id, sku: { startsWith: 'filler-' } },
        select: { id: true },
      })
    ).map((row) => row.id);

    await mergeWishlist(scope, filler);
    await expect(listWishlist(scope)).resolves.toHaveLength(MAX_WISHLIST);

    const oneMore = await makeProduct(store.id, 'OneTooMany');
    await expect(addToWishlist(scope, oneMore)).resolves.toBe(false);
    await expect(listWishlist(scope)).resolves.toHaveLength(MAX_WISHLIST);
  });
});
