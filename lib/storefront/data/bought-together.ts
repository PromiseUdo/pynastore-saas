/*
 * lib/storefront/data/bought-together.ts
 *
 * "Often bought together", from the store's real sales — the one
 * recommendation signal that is about what customers DID rather than what
 * products look like.
 *
 * A basket is a storefront order the merchant has accepted (confirmed or
 * later — not pending, not cancelled) or a sent/paid invoice from the admin.
 * Two products are "bought together" when they share at least
 * MIN_SHARED_BASKETS baskets. The floor matters twice over: one basket is an
 * anecdote, and a pair seen in a single order would let a stranger infer what
 * one particular customer bought.
 *
 * Read on demand for one product (like reviews), bounded to its most recent
 * baskets, and only ever inside one organisation.
 */
import { prisma } from '@/lib/prisma';
import type { OrderStatus } from '@/lib/generated/prisma/client';

export const MIN_SHARED_BASKETS = 2;
/** How many of a product's most recent baskets are looked at. */
const MAX_BASKETS = 300;
const MAX_RESULTS = 12;

const ACCEPTED_ORDER: OrderStatus[] = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];
/* The statuses soldCounts() in ./from-prisma.ts treats as a sale. */
const SOLD_INVOICE = ['SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'] as const;

export interface BoughtTogether {
  productId: string;
  /** distinct baskets containing both products */
  baskets: number;
}

export async function boughtTogetherFromDb(organizationId: string, productId: string): Promise<BoughtTogether[]> {
  const [orders, invoices] = await Promise.all([
    prisma.orderLineItem.findMany({
      where: { productId, order: { organizationId, status: { in: ACCEPTED_ORDER } } },
      select: { orderId: true },
      distinct: ['orderId'],
      orderBy: { order: { placedAt: 'desc' } },
      take: MAX_BASKETS,
    }),
    prisma.invoiceLineItem.findMany({
      where: {
        invoice: { organizationId, status: { in: [...SOLD_INVOICE] } },
        // Invoices can name the variant; roll it up to its product.
        OR: [{ inventoryItemId: productId }, { inventoryItem: { parentItemId: productId } }],
      },
      select: { invoiceId: true },
      distinct: ['invoiceId'],
      take: MAX_BASKETS,
    }),
  ]);
  if (!orders.length && !invoices.length) return [];

  const [orderLines, invoiceLines] = await Promise.all([
    orders.length
      ? prisma.orderLineItem.findMany({
          where: { orderId: { in: orders.map((o) => o.orderId) }, productId: { not: null } },
          select: { orderId: true, productId: true },
        })
      : [],
    invoices.length
      ? prisma.invoiceLineItem.findMany({
          where: { invoiceId: { in: invoices.map((i) => i.invoiceId) }, inventoryItemId: { not: null } },
          select: { invoiceId: true, inventoryItemId: true, inventoryItem: { select: { parentItemId: true } } },
        })
      : [],
  ]);

  const basketsOf = new Map<string, Set<string>>();
  const add = (other: string, basket: string) => {
    if (other === productId) return;
    const set = basketsOf.get(other) ?? new Set<string>();
    set.add(basket);
    basketsOf.set(other, set);
  };
  for (const line of orderLines) add(line.productId!, `o:${line.orderId}`);
  for (const line of invoiceLines) {
    add(line.inventoryItem?.parentItemId ?? line.inventoryItemId!, `i:${line.invoiceId}`);
  }

  return rankBoughtTogether(basketsOf);
}

/** Pure: basket sets → the pairs worth showing, strongest first. */
export function rankBoughtTogether(basketsOf: Map<string, Set<string>>): BoughtTogether[] {
  return [...basketsOf.entries()]
    .map(([productId, baskets]) => ({ productId, baskets: baskets.size }))
    .filter((entry) => entry.baskets >= MIN_SHARED_BASKETS)
    .sort((a, b) => b.baskets - a.baskets || a.productId.localeCompare(b.productId))
    .slice(0, MAX_RESULTS);
}
