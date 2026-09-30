/*
 * Platform console → Domains (ROADMAP 11.5): paid domain work, oldest first,
 * against the 24-hour promise; renewals due; the Namecheap balance.
 */
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/layout/page-header';
import { getPlatformStaff } from '@/lib/platform-staff';
import { listDomainQueue, type QueueTab } from '@/features/platform/domains';
import { DomainQueueClient } from './_components/DomainQueueClient';

export const metadata: Metadata = { title: 'Domains' };

const TABS: QueueTab[] = ['WAITING', 'DONE', 'FAILED', 'ALL'];
type Props = { searchParams: Promise<{ tab?: string; page?: string }> };

export default async function DomainQueuePage({ searchParams }: Props) {
  // The layout's staff check runs alongside this page, not before it.
  if (!(await getPlatformStaff())) notFound();
  const params = await searchParams;
  const tab = TABS.includes(params.tab as QueueTab) ? (params.tab as QueueTab) : 'WAITING';
  const page = Number.parseInt(params.page ?? '1', 10) || 1;
  const result = await listDomainQueue({ tab, page });
  if (!result.success) throw new Error(result.error);
  if (result.data.rows.length === 0 && page > 1) redirect(tab === 'WAITING' ? '/platform/domains' : `/platform/domains?tab=${tab}`);

  return (
    <>
      <PageHeader
        title="Domains"
        description="Domains merchants have paid for or connected. Each should be live within 24 hours — oldest first."
      />
      <PageBody>
        <DomainQueueClient data={result.data} tab={tab} />
      </PageBody>
    </>
  );
}
