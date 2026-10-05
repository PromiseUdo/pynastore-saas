/*
 * Platform console → Billing settings (ROADMAP 11.7): the free trial, the
 * grace period, the dollar-to-naira rate for domain prices, and store-app
 * prices (ROADMAP 16.2).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/layout/page-header';
import { getPlatformStaff } from '@/lib/platform-staff';
import { getConsoleBillingSettings } from '@/features/platform/billing-settings';
import { BillingSettingsForm } from './_components/BillingSettingsForm';

export const metadata: Metadata = { title: 'Billing settings' };

export default async function ConsoleBillingSettingsPage() {
  // The layout's staff check runs alongside this page, not before it.
  if (!(await getPlatformStaff())) notFound();
  const result = await getConsoleBillingSettings();
  if (!result.success) throw new Error(result.error);

  return (
    <>
      <PageHeader
        title="Billing settings"
        description="The free trial new merchants get, how long a shop stays open after its plan ends, the exchange rate for domain prices, and what store apps cost."
      />
      <PageBody>
        <BillingSettingsForm settings={result.data} />
      </PageBody>
    </>
  );
}
