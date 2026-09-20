/*
 * lib/storefront/discounts/usage.ts
 *
 * A code's use, given back and taken again — the twin of ../orders/stock.ts.
 *
 * A limited code ("50 uses") is held by an order exactly the way stock is: it
 * is claimed when the order is written, given back when the order is
 * cancelled, and re-claimed if a late payment brings that order back. Without
 * the release, a promotion of 50 would quietly shrink every time someone
 * abandoned a checkout.
 *
 * Both calls take the transaction they run in, so the order's state and the
 * code's count can never commit apart — and both take the code's id rather
 * than the order's, so an order WITHOUT a code costs nothing at all. Callers
 * are already reading the order they're cancelling; adding `discountCodeId`
 * to that select is free, where a lookup in here would be one more round
 * trip inside a cancellation on every order, coded or not.
 */
import { prisma } from '@/lib/prisma';

/** The transaction client, named the same way ../orders/stock.ts names it. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Give back the use an order was holding. A no-op for an order with no code. */
export async function releaseDiscountUse(tx: Tx, discountCodeId: string | null): Promise<void> {
  if (!discountCodeId) return;

  /* Floored at zero: a count already corrected by hand must not be driven
   * negative by a cancellation arriving afterwards. */
  await tx.discountCode.updateMany({
    where: { id: discountCodeId, usageCount: { gt: 0 } },
    data: { usageCount: { decrement: 1 } },
  });
}

/**
 * Take the use back for an order that has come back from the dead.
 *
 * Unlike placing the order, this does NOT refuse when the code has since run
 * out: the customer has already paid, and the merchant honouring one order
 * past a limit is better than a paid order left cancelled.
 */
export async function reclaimDiscountUse(tx: Tx, discountCodeId: string | null): Promise<void> {
  if (!discountCodeId) return;

  await tx.discountCode.updateMany({
    where: { id: discountCodeId },
    data: { usageCount: { increment: 1 } },
  });
}
