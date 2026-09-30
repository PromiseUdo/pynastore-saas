/*
 * Platform console → Merchants (ROADMAP 11.2).
 *
 * Every workspace, newest first. Status, plan state, search and page live in
 * the URL (AGENTS §3).
 */
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/layout/page-header';
import { getPlatformStaff } from '@/lib/platform-staff';
import { listMerchants, type MerchantPlanFilter, type MerchantStatusFilter } from '@/features/platform/merchants';
import { MerchantsClient } from './_components/MerchantsClient';

export const metadata: Metadata = { title: 'Merchants' };

const STATUSES: MerchantStatusFilter[] = ['all', 'active', 'suspended'];
const PLANS: MerchantPlanFilter[] = ['all', 'active', 'trial', 'grace', 'lapsed', 'none'];

type Props = { searchParams: Promise<{ status?: string; plan?: string; q?: string; page?: string }> };

export default async function MerchantsPage({ searchParams }: Props) {
  // The layout's staff check runs alongside this page, not before it.
  if (!(await getPlatformStaff())) notFound();
  const params = await searchParams;
  const status = STATUSES.includes(params.status as MerchantStatusFilter) ? (params.status as MerchantStatusFilter) : 'all';
  const plan = PLANS.includes(params.plan as MerchantPlanFilter) ? (params.plan as MerchantPlanFilter) : 'all';
  const page = Number.parseInt(params.page ?? '1', 10) || 1;
  const q = params.q?.trim() ?? '';

  const result = await listMerchants({ status, plan, q, page });
  if (!result.success) throw new Error(result.error);

  // Past the end of a shorter list, go back to its first page.
  if (result.data.rows.length === 0 && page > 1) {
    const qs = new URLSearchParams({
      ...(status !== 'all' ? { status } : {}),
      ...(plan !== 'all' ? { plan } : {}),
      ...(q ? { q } : {}),
    }).toString();
    redirect(qs ? `/platform/merchants?${qs}` : '/platform/merchants');
  }

  return (
    <>
      <PageHeader
        title="Merchants"
        description="Every business on the platform: where it is with its plan, how much it's selling, and whether it can take online payments."
      />
      <PageBody>
        <MerchantsClient data={result.data} status={status} plan={plan} q={q} />
      </PageBody>
    </>
  );
}
