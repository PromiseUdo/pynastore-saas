/*
 * /account/addresses/new — a full page, not a dialog.
 *
 * Eight fields with a country-dependent region list is more than a dialog
 * should hold on a phone, and a page keeps the browser's own Back button
 * meaningful if someone changes their mind halfway through.
 */
import type { Metadata } from 'next';
import { getShopper } from '@/lib/storefront/account/session';
import { listAddresses } from '@/lib/storefront/account/addresses';
import { getCheckoutConfig } from '@/lib/storefront/checkout/config';
import { AccountCard } from '../../../_components/account-card';
import { AddressForm } from '../../../_components/address-form';
import { BackLink } from '../../../_components/back-link';

export const metadata: Metadata = { title: 'Add an address' };

export default async function NewAddressPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const shopper = (await getShopper())!;

  const [config, existing] = await Promise.all([
    getCheckoutConfig({ organizationSlug }),
    listAddresses({ organizationId: shopper.organizationId, customerId: shopper.id }),
  ]);

  return (
    <div className="space-y-4">
      <BackLink href="/account/addresses">Your addresses</BackLink>
      <AccountCard titleAs="h1" title="Add an address" description="Where should we deliver your orders?">
        <AddressForm config={config} isOnlyAddress={existing.length === 0} />
      </AccountCard>
    </div>
  );
}

