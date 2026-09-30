/*
 * Platform console → Scheduled jobs (ROADMAP 13.1): the chores the platform
 * runs on a timer, whether each is running when it should, and what its runs
 * said. Recorded by lib/cron/run.ts whichever scheduler starts them.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/layout/page-header';
import { getPlatformStaff } from '@/lib/platform-staff';
import { getJobsPage } from '@/features/platform/jobs';
import { JobsClient } from './_components/JobsClient';

export const metadata: Metadata = { title: 'Scheduled jobs' };

type Props = { searchParams: Promise<{ job?: string }> };

export default async function JobsPage({ searchParams }: Props) {
  // The layout's staff check runs alongside this page, not before it.
  if (!(await getPlatformStaff())) notFound();
  const { job } = await searchParams;
  const result = await getJobsPage({ job });
  if (!result.success) throw new Error(result.error);

  return (
    <>
      <PageHeader
        title="Scheduled jobs"
        description="Chores the platform does on a timer. Every run is recorded here, whoever started it, and staff are emailed when one fails or stops running."
      />
      <PageBody>
        <JobsClient data={result.data} jobFilter={job ?? ''} />
      </PageBody>
    </>
  );
}
