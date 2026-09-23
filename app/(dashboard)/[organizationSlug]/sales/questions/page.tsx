/*
 * Sales → Questions.
 *
 * What shoppers asked about products, and the answers the store gave. A
 * question is not on the storefront until someone here answers it, so this
 * page is a to-do list first: waiting questions come before the rest.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { listQuestions } from '@/features/sales/questions';
import { QuestionsPageClient } from './_components/QuestionsPageClient';

export const metadata: Metadata = { title: 'Questions' };

const FILTERS = ['pending', 'answered', 'hidden'] as const;

export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SALES_VIEW)) return <AccessDenied what="customer questions" />;

  const { status, q } = await searchParams;
  const filter = FILTERS.find((value) => value === status) ?? 'all';

  const result = await listQuestions({ status: filter, search: q });
  if (!result.success) throw new Error(result.error);

  return (
    <QuestionsPageClient
      rows={result.data.rows}
      summary={result.data.summary}
      status={filter}
      query={q ?? ''}
      canAnswer={hasPermission(perms, PERMISSIONS.SALES_QUESTION_ANSWER)}
    />
  );
}
