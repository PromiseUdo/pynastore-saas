/*
 * lib/storefront/reviews/read.ts
 *
 * Reading reviews, and deciding who is allowed to write one.
 *
 * WHO MAY REVIEW: a signed-in shopper who has an order from this store that
 * reached DELIVERED and contained this product. That is the whole rule, and
 * it is answered here from the merchant's own order records — never from
 * anything the browser claims. A shopper with no such order sees no form.
 *
 * Every query names the organization as well as the customer. A product id
 * is unique across the platform, but scoping by the store too means a
 * mistake upstream can only ever return nothing, not someone else's rows.
 */
import { prisma } from '@/lib/prisma';
import type { Review } from '../types';
import type { ReviewSummary } from '../types';
import { displayName, summariseCounts, type Rating } from './rules';

export type ReviewRow = {
  id: string;
  productId: string;
  rating: number;
  title: string;
  body: string;
  helpfulCount: number;
  createdAt: Date;
  customer: { name: string };
};

const PUBLIC_SELECT = {
  id: true,
  productId: true,
  rating: true,
  title: true,
  body: true,
  helpfulCount: true,
  createdAt: true,
  customer: { select: { name: true } },
} as const;

/**
 * Every review is written by someone who received the goods, so `verified`
 * is true on all of them — see the model in prisma/schema.prisma. It stays
 * in the shape (and in the badge) because it is the thing worth saying.
 */
function toReview(row: ReviewRow): Review {
  return {
    id: row.id,
    productId: row.productId,
    author: displayName(row.customer.name),
    rating: row.rating as Rating,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    verified: true,
    helpful: row.helpfulCount,
  };
}

/** The published reviews of one product, newest first. */
export async function listPublishedReviews(organizationId: string, productId: string): Promise<Review[]> {
  const rows = await prisma.productReview.findMany({
    where: { organizationId, productId, status: 'PUBLISHED' },
    orderBy: { createdAt: 'desc' },
    select: PUBLIC_SELECT,
  });
  return rows.map(toReview);
}

/**
 * Every product's rating summary for one store, in a single grouped query.
 *
 * The catalogue loads all of them at once (../data/from-prisma.ts): a store
 * renders many products per page, and a query per card is how a listing page
 * becomes slow. Products with no reviews are simply absent from the map, and
 * the mapper gives those the unrated summary rather than a zero score.
 */
export async function ratingSummaries(organizationId: string): Promise<Map<string, ReviewSummary>> {
  const grouped = await prisma.productReview.groupBy({
    by: ['productId', 'rating'],
    where: { organizationId, status: 'PUBLISHED' },
    _count: { _all: true },
  });

  const counts = new Map<string, Partial<Record<Rating, number>>>();
  for (const row of grouped) {
    const forProduct = counts.get(row.productId) ?? {};
    forProduct[row.rating as Rating] = (forProduct[row.rating as Rating] ?? 0) + row._count._all;
    counts.set(row.productId, forProduct);
  }

  return new Map([...counts].map(([productId, byStar]) => [productId, summariseCounts(byStar)]));
}

/* ---------------- who may write one ---------------- */

/** The shopper's own review of a product, as the form needs it back. */
export interface OwnReview {
  id: string;
  rating: number;
  title: string;
  body: string;
  status: 'PUBLISHED' | 'HIDDEN';
  createdAt: string;
}

export interface ReviewOpportunity {
  /** true when this shopper has received this product and may write about it */
  canReview: boolean;
  /** the delivered order that entitles it — what a new review is filed against */
  orderId: string | null;
  /** what they already said, if anything; a second review edits this one */
  own: OwnReview | null;
}

const NO_OPPORTUNITY: ReviewOpportunity = { canReview: false, orderId: null, own: null };

/**
 * The most recent delivered order of this product by this shopper, plus the
 * review they may already have written.
 *
 * Both halves matter to the caller: without an order there is no form, and
 * with an existing review the form opens on what they wrote before.
 */
export async function reviewOpportunity(input: {
  organizationId: string;
  customerId: string | null;
  productId: string;
}): Promise<ReviewOpportunity> {
  const { organizationId, customerId, productId } = input;
  if (!customerId) return NO_OPPORTUNITY;

  const [order, own] = await Promise.all([
    prisma.order.findFirst({
      where: {
        organizationId,
        customerId,
        status: 'DELIVERED',
        lineItems: { some: { productId } },
      },
      orderBy: { deliveredAt: 'desc' },
      select: { id: true },
    }),
    prisma.productReview.findUnique({
      where: { customerId_productId: { customerId, productId } },
      select: { id: true, rating: true, title: true, body: true, status: true, createdAt: true, organizationId: true },
    }),
  ]);

  return {
    canReview: Boolean(order),
    orderId: order?.id ?? null,
    own:
      own && own.organizationId === organizationId
        ? {
            id: own.id,
            rating: own.rating,
            title: own.title,
            body: own.body,
            status: own.status,
            createdAt: own.createdAt.toISOString(),
          }
        : null,
  };
}

/** Which reviews on this page the shopper has already found helpful. */
export async function votedReviewIds(customerId: string | null, reviewIds: string[]): Promise<Set<string>> {
  if (!customerId || reviewIds.length === 0) return new Set();
  const rows = await prisma.productReviewVote.findMany({
    where: { customerId, reviewId: { in: reviewIds } },
    select: { reviewId: true },
  });
  return new Set(rows.map((row) => row.reviewId));
}

/**
 * Products from a shopper's delivered orders that they haven't reviewed yet.
 * Drives the prompt on /account/orders — the moment a review is most likely
 * to be written is the one where someone is looking at what they received.
 */
export async function awaitingReview(input: {
  organizationId: string;
  customerId: string;
  limit?: number;
}): Promise<{ productId: string; name: string; slug: string | null; imageUrl: string | null; deliveredAt: string | null }[]> {
  const orders = await prisma.order.findMany({
    where: { organizationId: input.organizationId, customerId: input.customerId, status: 'DELIVERED' },
    orderBy: { deliveredAt: 'desc' },
    take: 20,
    select: {
      deliveredAt: true,
      lineItems: { select: { productId: true, name: true, slug: true, imageUrl: true } },
    },
  });

  const reviewed = new Set(
    (
      await prisma.productReview.findMany({
        where: { organizationId: input.organizationId, customerId: input.customerId },
        select: { productId: true },
      })
    ).map((row) => row.productId),
  );

  const seen = new Set<string>();
  const out: { productId: string; name: string; slug: string | null; imageUrl: string | null; deliveredAt: string | null }[] = [];

  for (const order of orders) {
    for (const line of order.lineItems) {
      if (!line.productId || reviewed.has(line.productId) || seen.has(line.productId)) continue;
      seen.add(line.productId);
      out.push({
        productId: line.productId,
        name: line.name,
        slug: line.slug,
        imageUrl: line.imageUrl,
        deliveredAt: order.deliveredAt?.toISOString() ?? null,
      });
      if (out.length >= (input.limit ?? 6)) return out;
    }
  }

  return out;
}
