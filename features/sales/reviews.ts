'use server';

/*
 * features/sales/reviews.ts
 *
 * The merchant's side of customer reviews.
 *
 * A merchant cannot write a review, edit one, or reply to one — reviews come
 * from shoppers who received the goods (lib/storefront/reviews/) and nothing
 * here can create one. What a merchant CAN do is hide a review that breaks
 * the rules: abuse, someone's phone number, a rant about a courier.
 *
 * Hiding takes it off the storefront and out of the product's average; it
 * does not delete it. The row stays, with who hid it and why in the audit
 * log, and it can be put back. A merchant who could quietly delete every
 * two-star review would leave a five-star average that means nothing.
 *
 * Viewing needs `sales.view`; hiding needs `sales.review.moderate`.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';

type Result<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface ReviewRow {
  id: string;
  rating: number;
  title: string;
  body: string;
  status: 'PUBLISHED' | 'HIDDEN';
  hiddenReason: string | null;
  helpfulCount: number;
  createdAt: string;
  customerName: string;
  customerEmail: string | null;
  productId: string;
  productName: string;
  productSlug: string | null;
  orderReference: string;
}

export interface ReviewListSummary {
  total: number;
  published: number;
  hidden: number;
  /** average of the published ones, across the whole store — one decimal */
  average: number;
}

export type ReviewStatusFilter = 'all' | 'published' | 'hidden';

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to moderate reviews' };
  }
  console.error(`[sales/reviews] ${fallback}:`, error);
  return { success: false, error: fallback };
}

async function context(permission: 'view' | 'moderate') {
  const ctx = await getOrganizationContext();
  requirePermission(
    ctx.membership.role.permissions,
    permission === 'view' ? PERMISSIONS.SALES_VIEW : PERMISSIONS.SALES_REVIEW_MODERATE,
  );
  return ctx;
}

export async function listReviews(
  filter: { status?: ReviewStatusFilter; search?: string } = {},
): Promise<Result<{ rows: ReviewRow[]; summary: ReviewListSummary }>> {
  try {
    const ctx = await context('view');
    const organizationId = ctx.organization.id;
    const search = filter.search?.trim();

    const where = {
      organizationId,
      ...(filter.status === 'published' ? { status: 'PUBLISHED' as const } : {}),
      ...(filter.status === 'hidden' ? { status: 'HIDDEN' as const } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' as const } },
              { body: { contains: search, mode: 'insensitive' as const } },
              { product: { name: { contains: search, mode: 'insensitive' as const } } },
              { customer: { name: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [rows, counts, published] = await Promise.all([
      prisma.productReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          rating: true,
          title: true,
          body: true,
          status: true,
          hiddenReason: true,
          helpfulCount: true,
          createdAt: true,
          productId: true,
          customer: { select: { name: true, email: true } },
          product: { select: { name: true, slug: true } },
          order: { select: { reference: true } },
        },
      }),
      prisma.productReview.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
      }),
      prisma.productReview.aggregate({
        where: { organizationId, status: 'PUBLISHED' },
        _avg: { rating: true },
      }),
    ]);

    const byStatus = new Map(counts.map((row) => [row.status, row._count._all]));
    const publishedCount = byStatus.get('PUBLISHED') ?? 0;
    const hiddenCount = byStatus.get('HIDDEN') ?? 0;

    return {
      success: true,
      data: {
        rows: rows.map((row) => ({
          id: row.id,
          rating: row.rating,
          title: row.title,
          body: row.body,
          status: row.status,
          hiddenReason: row.hiddenReason,
          helpfulCount: row.helpfulCount,
          createdAt: row.createdAt.toISOString(),
          customerName: row.customer.name,
          customerEmail: row.customer.email,
          productId: row.productId,
          productName: row.product.name,
          productSlug: row.product.slug,
          orderReference: row.order.reference,
        })),
        summary: {
          total: publishedCount + hiddenCount,
          published: publishedCount,
          hidden: hiddenCount,
          average: Math.round((published._avg.rating ?? 0) * 10) / 10,
        },
      },
    };
  } catch (error) {
    return failure(error, 'We couldn’t load your reviews');
  }
}

const HideSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Say briefly why, so the decision makes sense later')
    .max(200, 'Keep it under 200 characters'),
});

/** Take a review off the storefront. The reason is for the merchant's own
 *  record — the shopper is not told, and it never appears on the store. */
export async function hideReview(reviewId: string, reason: string): Promise<Result> {
  try {
    const ctx = await context('moderate');
    const parsed = HideSchema.safeParse({ reason });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Give a reason for hiding it' };
    }

    const updated = await prisma.productReview.updateMany({
      where: { id: reviewId, organizationId: ctx.organization.id },
      data: { status: 'HIDDEN', hiddenReason: parsed.data.reason, hiddenAt: new Date() },
    });
    if (!updated.count) return { success: false, error: 'That review no longer exists' };

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.review.hide',
      entityType: 'ProductReview',
      entityId: reviewId,
      metadata: { reason: parsed.data.reason },
    });

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t hide this review');
  }
}

/** Put a hidden review back on the storefront. */
export async function restoreReview(reviewId: string): Promise<Result> {
  try {
    const ctx = await context('moderate');

    const updated = await prisma.productReview.updateMany({
      where: { id: reviewId, organizationId: ctx.organization.id },
      data: { status: 'PUBLISHED', hiddenReason: null, hiddenAt: null },
    });
    if (!updated.count) return { success: false, error: 'That review no longer exists' };

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.review.restore',
      entityType: 'ProductReview',
      entityId: reviewId,
    });

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t restore this review');
  }
}
