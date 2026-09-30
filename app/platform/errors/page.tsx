/*
 * Platform console → Errors (ROADMAP 13.3): what has gone wrong on the
 * server, in shoppers' and merchants' browsers, and in webhooks — grouped,
 * newest first. Filled by lib/ops/errors.ts.
 */
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { getPlatformStaff } from '@/lib/platform-staff';
import { listErrors, type ErrorSourceFilter, type ErrorStatusFilter } from '@/features/platform/errors';
import { ErrorsClient } from './_components/ErrorsClient';

export const metadata: Metadata = { title: 'Errors' };

const STATUSES: ErrorStatusFilter[] = ['open', 'resolved', 'all'];
const SOURCES: ErrorSourceFilter[] = ['all', 'server', 'client', 'webhook'];
type Props = { searchParams: Promise<{ status?: string; source?: string; q?: string; page?: string }> };

export default async function ErrorsPage({ searchParams }: Props) {
  // The layout's staff check runs alongside this page, not before it.
  if (!(await getPlatformStaff())) notFound();
  const params = await searchParams;
  const status = STATUSES.includes(params.status as ErrorStatusFilter) ? (params.status as ErrorStatusFilter) : 'open';
  const source = SOURCES.includes(params.source as ErrorSourceFilter) ? (params.source as ErrorSourceFilter) : 'all';
  const q = params.q ?? '';
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  const result = await listErrors({ status, source, q, page });
  if (!result.success) throw new Error(result.error);
  if (result.data.rows.length === 0 && page > 1) redirect('/platform/errors');

  return (
    <>
      <PageHeader
        title="Errors"
        description="What went wrong on the server, in people’s browsers and in webhooks — grouped, newest first. Staff are emailed about new ones and spikes."
      />
      <ErrorsClient data={result.data} status={status} source={source} q={q} />
    </>
  );
}
