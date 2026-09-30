/*
 * Platform console → Payments (ROADMAP 11.6): what went wrong with money on
 * its way to merchants. Paystack settles to each merchant directly, so there
 * are no payouts to run — only problems to look into.
 */
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/layout/page-header';
import { getPlatformStaff } from '@/lib/platform-staff';
import { listPaymentProblems, type PaymentTab } from '@/features/platform/payments';
import { PaymentsClient } from './_components/PaymentsClient';

export const metadata: Metadata = { title: 'Payments' };

const TABS: PaymentTab[] = ['mismatched', 'unmatched', 'disputes', 'payouts', 'stuck'];
type Props = { searchParams: Promise<{ tab?: string; page?: string }> };

export default async function PaymentsPage({ searchParams }: Props) {
  // The layout's staff check runs alongside this page, not before it.
  if (!(await getPlatformStaff())) notFound();
  const params = await searchParams;
  const tab = TABS.includes(params.tab as PaymentTab) ? (params.tab as PaymentTab) : 'mismatched';
  const page = Number.parseInt(params.page ?? '1', 10) || 1;
  const result = await listPaymentProblems({ tab, page });
  if (!result.success) throw new Error(result.error);
  if (result.data.rows.length === 0 && page > 1) redirect(`/platform/payments?tab=${tab}`);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Money problems to look into. Paystack pays merchants directly, so there are no payouts to run — only what went wrong on the way."
      />
      <PageBody>
        <PaymentsClient data={result.data} />
      </PageBody>
    </>
  );
}
