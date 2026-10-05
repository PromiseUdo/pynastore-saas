/*
 * Platform console → Store apps (ROADMAP 16.2): stores' own phone apps —
 * paid ones to build first, oldest paid first, then delivered, live, unpaid
 * requests and switched-off apps.
 */
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/layout/page-header';
import { getPlatformStaff } from '@/lib/platform-staff';
import { listAppQueue, type AppQueueTab } from '@/features/platform/mobile-apps';
import { AppQueueClient } from './_components/AppQueueClient';

export const metadata: Metadata = { title: 'Store apps' };

const TABS: AppQueueTab[] = ['TO_BUILD', 'DELIVERED', 'LIVE', 'UNPAID', 'SWITCHED_OFF', 'ALL'];
type Props = { searchParams: Promise<{ tab?: string; page?: string }> };

export default async function AppQueuePage({ searchParams }: Props) {
  // The layout's staff check runs alongside this page, not before it.
  if (!(await getPlatformStaff())) notFound();
  const params = await searchParams;
  const tab = TABS.includes(params.tab as AppQueueTab) ? (params.tab as AppQueueTab) : 'TO_BUILD';
  const page = Number.parseInt(params.page ?? '1', 10) || 1;
  const result = await listAppQueue({ tab, page });
  if (!result.success) throw new Error(result.error);
  if (result.data.rows.length === 0 && page > 1) redirect(tab === 'TO_BUILD' ? '/platform/mobile-apps' : `/platform/mobile-apps?tab=${tab}`);

  return (
    <>
      <PageHeader
        title="Store apps"
        description="Merchants’ own Android and iPhone apps. Build the paid ones with the kit (docs/MOBILE-BUILD.md), oldest first."
      />
      <PageBody>
        <AppQueueClient data={result.data} tab={tab} />
      </PageBody>
    </>
  );
}
