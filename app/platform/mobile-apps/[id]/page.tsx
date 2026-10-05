/*
 * Platform console → Store apps → one app (ROADMAP 16.2): what the merchant
 * asked for, the build kit's commands, and the steps — building, delivered,
 * listed — plus switching it off or on.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPlatformStaff } from '@/lib/platform-staff';
import { getAppOrder } from '@/features/platform/mobile-apps';
import { AppOrderClient } from './_components/AppOrderClient';

export const metadata: Metadata = { title: 'Store app' };

export default async function AppOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getPlatformStaff())) notFound();
  const result = await getAppOrder(id);
  if (!result.success) throw new Error(result.error);
  if (!result.data) notFound();
  return <AppOrderClient app={result.data} />;
}
