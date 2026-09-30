/*
 * Platform console → Domains → one order (ROADMAP 11.5): the checklist for
 * its kind, the registrant, the records, and Mark live / Mark failed /
 * Record refund.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPlatformStaff } from '@/lib/platform-staff';
import { getDomainOrder } from '@/features/platform/domains';
import { DomainOrderClient } from './_components/DomainOrderClient';

export const metadata: Metadata = { title: 'Domain order' };

export default async function DomainOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!(await getPlatformStaff())) notFound();
  const result = await getDomainOrder(orderId);
  if (!result.success) throw new Error(result.error);
  if (!result.data) notFound();
  return <DomainOrderClient order={result.data} />;
}
