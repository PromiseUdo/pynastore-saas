'use client';

/*
 * The store's name, linked home.
 *
 * A Client Component purely to read `useStorefront()` — the org's public
 * identity is already in context for the whole storefront (set by the root
 * layout from the tenant lookup), and reading it here keeps the checkout
 * layout from having to resolve the tenant a second time.
 *
 * It is the same identity the full site header shows, so a shopper crossing
 * from the catalogue into checkout sees no change of ownership. That
 * continuity is the entire job of this component: an unfamiliar header on a
 * payment page is how a checkout loses trust.
 */
import Link from 'next/link';
import Image from 'next/image';
import { useStorefront } from '@/lib/storefront/context';

export function StoreWordmark() {
  const { org } = useStorefront();

  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label={`${org.name} — home`}>
      {org.logoUrl ? (
        <Image src={org.logoUrl} alt="" width={28} height={28} className="size-7 rounded-md object-contain" />
      ) : null}
      <span className="font-display text-lg leading-none">{org.name}</span>
    </Link>
  );
}
