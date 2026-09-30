/*
 * Platform console → Verification → one business (ROADMAP 11.3).
 *
 * Everything the merchant sent, their documents behind short-lived links,
 * and the decision. Laid out like any detail page (AGENTS §2): back link,
 * title, status, the key facts, then the detail.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getVerificationCase } from '@/features/platform/verification';
import { syncSubaccount } from '@/lib/payments/subaccounts';
import { getPlatformStaff } from '@/lib/platform-staff';
import { CaseClient } from './_components/CaseClient';

export const metadata: Metadata = { title: 'Review business' };

type Props = { params: Promise<{ organizationId: string }> };

export default async function VerificationCasePage({ params }: Props) {
  const { organizationId } = await params;
  // A layout and its page render concurrently, so the layout's staff check
  // can't be relied on to run first: check here before touching Paystack.
  if (!(await getPlatformStaff())) notFound();
  // Paystack sends no subaccount webhooks; refresh a stale copy on the way in.
  await syncSubaccount(organizationId);
  const result = await getVerificationCase(organizationId);
  if (!result.success) throw new Error(result.error);
  if (!result.data) notFound();
  return <CaseClient data={result.data} />;
}
