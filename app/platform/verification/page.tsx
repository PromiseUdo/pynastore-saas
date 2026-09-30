/*
 * Platform console → Verification (ROADMAP 11.3).
 *
 * Businesses that asked to take online payments, waiting for our check.
 * Status, search and page live in the URL (AGENTS §3) and become the query.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { listVerificationQueue, type QueueFilter } from '@/features/platform/verification';
import { QueueClient } from './_components/QueueClient';

export const metadata: Metadata = { title: 'Verification' };

const FILTERS: QueueFilter[] = ['PENDING', 'REJECTED', 'VERIFIED', 'ALL'];

type Props = { searchParams: Promise<{ status?: string; q?: string; page?: string }> };

export default async function VerificationQueuePage({ searchParams }: Props) {
  const params = await searchParams;
  const status = FILTERS.includes(params.status as QueueFilter) ? (params.status as QueueFilter) : 'PENDING';
  const page = Number.parseInt(params.page ?? '1', 10) || 1;
  const q = params.q?.trim() ?? '';

  const result = await listVerificationQueue({ status, q, page });
  if (!result.success) throw new Error(result.error);

  // Switching tabs keeps the page number; past the end of a shorter list,
  // go back to its first page rather than showing an empty one.
  if (result.data.rows.length === 0 && page > 1) {
    const qs = new URLSearchParams({ ...(status !== 'PENDING' ? { status } : {}), ...(q ? { q } : {}) }).toString();
    redirect(qs ? `/platform/verification?${qs}` : '/platform/verification');
  }

  return (
    <>
      <PageHeader
        title="Verification"
        description="Businesses that asked to take online payments. Check their details and documents, then approve them or send them back."
      />
      <PageBody>
        <QueueClient data={result.data} status={status} q={q} />
      </PageBody>
    </>
  );
}
