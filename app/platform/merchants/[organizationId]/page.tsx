/*
 * Platform console → Merchants → one merchant (ROADMAP 11.2, 11.4).
 *
 * Laid out like any detail page (AGENTS §2): back link, name and status,
 * the key facts, then members, billing history and domain orders. Suspend
 * and restore live here.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPlatformStaff } from '@/lib/platform-staff';
import { getAdminUrl } from '@/lib/tenant/urls';
import { getMerchant } from '@/features/platform/merchants';
import { MerchantDetailClient } from './_components/MerchantDetailClient';
import { storefrontUrlFor } from '@/lib/domains/storefront-url';

export const metadata: Metadata = { title: 'Merchant' };

type Props = { params: Promise<{ organizationId: string }> };

export default async function MerchantPage({ params }: Props) {
  const { organizationId } = await params;
  // The layout's staff check runs alongside this page, not before it.
  if (!(await getPlatformStaff())) notFound();
  const result = await getMerchant(organizationId);
  if (!result.success) throw new Error(result.error);
  if (!result.data) notFound();
  const slug = result.data.organization.slug;
  return (
    <MerchantDetailClient
      data={result.data}
      storefrontUrl={(await storefrontUrlFor(slug))}
      adminUrl={getAdminUrl(slug, '/dashboard')}
    />
  );
}
