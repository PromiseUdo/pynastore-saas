/*
 * lib/storefront/account/wishlist.ts
 *
 * The saved list, for a shopper who has an account.
 *
 * It stores ids and nothing else. A saved item must show today's price and
 * today's availability — a copy of the product taken on the day it was saved
 * would quietly become a lie, and the one thing a wishlist is for is coming
 * back to it later.
 *
 * Scoped like everything else in this folder: the customer AND the store,
 * inside the query. A product id from another merchant's catalogue simply
 * doesn't match, so one shopper can never save — or be shown — another
 * store's product through this list.
 *
 * MERGING is the operation that makes signing in safe. A shopper who saved
 * things as a guest and then signs in must not lose them, so the local list
 * is folded in rather than replaced. Overlap is free: the (customer,
 * product) unique constraint turns a second save into a no-op.
 */
import { prisma } from '@/lib/prisma';

/** Generous for a person, low enough that nobody can fill a table with junk. */
export const MAX_WISHLIST = 200;

export interface WishlistScope {
  organizationId: string;
  customerId: string;
}

/**
 * The saved product ids, newest first.
 *
 * Only products that still belong to this store come back. A merchant who
 * deletes a product takes it out of every list (the foreign key does that),
 * and a stale id from a browser is dropped here.
 */
export async function listWishlist(scope: WishlistScope): Promise<string[]> {
  const rows = await prisma.customerWishlistItem.findMany({
    where: {
      customerId: scope.customerId,
      customer: { organizationId: scope.organizationId },
      product: { organizationId: scope.organizationId },
    },
    orderBy: { createdAt: 'desc' },
    select: { productId: true },
    take: MAX_WISHLIST,
  });

  return rows.map((row) => row.productId);
}

/** Which of these ids this store actually sells — the gate on every write. */
async function ownedProductIds(scope: WishlistScope, productIds: string[]): Promise<string[]> {
  if (productIds.length === 0) return [];
  const rows = await prisma.inventoryItem.findMany({
    where: { id: { in: productIds }, organizationId: scope.organizationId },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export async function addToWishlist(scope: WishlistScope, productId: string): Promise<boolean> {
  const [owned] = await ownedProductIds(scope, [productId]);
  if (!owned) return false;

  const count = await prisma.customerWishlistItem.count({ where: { customerId: scope.customerId } });
  if (count >= MAX_WISHLIST) return false;

  // Saving something already saved is success, not a duplicate and not an error.
  await prisma.customerWishlistItem.upsert({
    where: { customerId_productId: { customerId: scope.customerId, productId: owned } },
    create: { customerId: scope.customerId, productId: owned },
    update: {},
  });

  return true;
}

export async function removeFromWishlist(scope: WishlistScope, productId: string): Promise<boolean> {
  const result = await prisma.customerWishlistItem.deleteMany({
    where: {
      productId,
      customerId: scope.customerId,
      customer: { organizationId: scope.organizationId },
    },
  });
  return result.count > 0;
}

/**
 * Fold a guest's saved list into the account's, and return the result.
 *
 * Called once, when a shopper signs in with things saved in the browser.
 * Nothing is removed: signing in can only ever ADD to what an account
 * already had, because a shopper who loses saved items by signing in learns
 * not to sign in.
 */
export async function mergeWishlist(
  scope: WishlistScope,
  productIds: string[],
): Promise<string[]> {
  const owned = await ownedProductIds(scope, [...new Set(productIds)].slice(0, MAX_WISHLIST));

  if (owned.length > 0) {
    const existing = await prisma.customerWishlistItem.count({
      where: { customerId: scope.customerId },
    });
    const room = Math.max(0, MAX_WISHLIST - existing);

    if (room > 0) {
      await prisma.customerWishlistItem.createMany({
        data: owned.slice(0, room).map((productId) => ({ customerId: scope.customerId, productId })),
        // Anything they already had stays exactly as it was, keeping its
        // original position in the list.
        skipDuplicates: true,
      });
    }
  }

  return listWishlist(scope);
}
