/*
 * /account/addresses — the address book.
 *
 * One card per address, the default marked and listed first, because that's
 * the one checkout will preselect and a shopper should be able to see which
 * without opening anything.
 *
 * Empty is a real state, not a blank page: it explains what the book is for
 * in one line and offers the only action that makes sense.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { MapPin, Plus } from 'lucide-react';
import { getShopper } from '@/lib/storefront/account/session';
import { listAddresses, MAX_ADDRESSES } from '@/lib/storefront/account/addresses';
import { AddressCard } from '../../_components/address-card';
import { AccountHeading } from '../../_components/account-heading';

export const metadata: Metadata = { title: 'Your addresses' };

export default async function AddressesPage() {
  const shopper = (await getShopper())!;
  const addresses = await listAddresses({
    organizationId: shopper.organizationId,
    customerId: shopper.id,
  });

  if (addresses.length === 0) {
    return (
      <>
        <AccountHeading>Your addresses</AccountHeading>
        <div className="rounded-3xl border border-border bg-card p-8 text-center">
        <MapPin className="mx-auto size-7 text-muted-foreground" aria-hidden />
        <h2 className="mt-3 font-display text-lg font-semibold">No saved addresses yet</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
          Save where you want deliveries to go and checkout will fill it in for you next time.
        </p>
        <Link
          href="/account/addresses/new"
          className="mt-5 inline-flex h-12 items-center gap-2 rounded-full bg-brand px-6 text-base font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
        >
          <Plus className="size-4" aria-hidden />
          Add an address
        </Link>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <AccountHeading hint="Checkout uses your default address unless you pick another.">
        Your addresses
      </AccountHeading>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {addresses.length < MAX_ADDRESSES && (
          <Link
            href="/account/addresses/new"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium transition-colors hover:border-brand hover:text-brand"
          >
            <Plus className="size-4" aria-hidden />
            Add an address
          </Link>
        )}
      </div>

      <ul className="grid gap-4 sm:grid-cols-2">
        {addresses.map((address) => (
          <li key={address.id}>
            <AddressCard address={address} />
          </li>
        ))}
      </ul>
    </div>
  );
}
