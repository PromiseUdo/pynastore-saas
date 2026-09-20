/*
 * Sales → Reviews.
 *
 * What customers said about the products they received. The merchant writes
 * none of this and can't edit a word of it — the only thing this page does
 * is take a review off the storefront, and put it back (features/sales/reviews.ts).
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { listReviews } from '@/features/sales/reviews';
import { ReviewsPageClient } from './_components/ReviewsPageClient';

export const metadata: Metadata = { title: 'Reviews' };

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SALES_VIEW)) return <AccessDenied what="customer reviews" />;

  const { status, q } = await searchParams;
  const filter = status === 'published' || status === 'hidden' ? status : 'all';

  const result = await listReviews({ status: filter, search: q });
  if (!result.success) throw new Error(result.error);

  return (
    <ReviewsPageClient
      rows={result.data.rows}
      summary={result.data.summary}
      status={filter}
      query={q ?? ''}
      canModerate={hasPermission(perms, PERMISSIONS.SALES_REVIEW_MODERATE)}
    />
  );
}
