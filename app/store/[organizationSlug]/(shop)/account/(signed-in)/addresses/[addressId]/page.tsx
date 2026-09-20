/*
 * /account/addresses/[addressId] — edit one.
 *
 * The address is fetched through the scoped query, so an id belonging to
 * somebody else is simply not found: this page cannot be used to read one
 * stranger's address book from another's session.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getShopper } from '@/lib/storefront/account/session';
import { BackLink } from '../../../_components/back-link';
import { getAddress, listAddresses } from '@/lib/storefront/account/addresses';
import { getCheckoutConfig } from '@/lib/storefront/checkout/config';
import { AccountCard } from '../../../_components/account-card';
import { AddressForm } from '../../../_components/address-form';
import { AccountNotFound } from '../../../_components/account-not-found';

export const metadata: Metadata = { title: 'Edit address' };

export default async function EditAddressPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; addressId: string }>;
}) {
  const { organizationSlug, addressId } = await params;
  const shopper = (await getShopper())!;
  const scope = { organizationId: shopper.organizationId, customerId: shopper.id };

  const [config, address, all] = await Promise.all([
    getCheckoutConfig({ organizationSlug }),
    getAddress(scope, addressId),
    listAddresses(scope),
  ]);

  if (!address) {
    return (
      <AccountNotFound
        title="We can’t find that address"
        description="It isn’t saved on this account any more. Your other addresses are all still here."
        backHref="/account/addresses"
        backLabel="Your addresses"
      />
    );
  }

  return (
    <div className="space-y-4">
      <BackLink href="/account/addresses">Your addresses</BackLink>

      <AccountCard
        titleAs="h1"
        title="Edit address"
        description={address.isDefault ? 'This is your default delivery address.' : undefined}
      >
        <AddressForm config={config} address={address} isOnlyAddress={all.length === 1} />
      </AccountCard>
    </div>
  );
}
