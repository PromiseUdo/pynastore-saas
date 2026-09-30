/*
 * Platform console → Errors → one error (ROADMAP 13.3): what it said, where,
 * how often lately, the latest stack, and each recent occurrence.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPlatformStaff } from '@/lib/platform-staff';
import { getErrorDetail } from '@/features/platform/errors';
import { ErrorDetailClient } from './_components/ErrorDetailClient';

export const metadata: Metadata = { title: 'Error' };

export default async function ErrorDetailPage({ params }: { params: Promise<{ errorId: string }> }) {
  const { errorId } = await params;
  if (!(await getPlatformStaff())) notFound();
  const result = await getErrorDetail(errorId);
  if (!result.success) throw new Error(result.error);
  if (!result.data) notFound();
  return <ErrorDetailClient detail={result.data} />;
}
