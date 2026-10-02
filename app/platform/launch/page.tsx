/*
 * Platform console → Go-live checklist (ROADMAP 13.9): what a live launch
 * depends on, checked against this server, and the steps only a person can
 * confirm. docs/GO-LIVE.md has the walkthrough.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { getPlatformStaff } from '@/lib/platform-staff';
import { getGoLive } from '@/features/platform/go-live';
import { GoLiveClient } from './_components/GoLiveClient';

export const metadata: Metadata = { title: 'Go-live checklist' };

export default async function GoLivePage() {
  if (!(await getPlatformStaff())) notFound();
  const result = await getGoLive();
  if (!result.success) throw new Error(result.error);
  return (
    <>
      <PageHeader
        title="Go-live checklist"
        description="Everything taking real money depends on — checked against this server’s settings — and the steps only a person can confirm."
      />
      <GoLiveClient data={result.data} />
    </>
  );
}
