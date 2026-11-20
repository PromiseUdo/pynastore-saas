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
 *
 * A logo stands alone, at the size the site header gives it: the logo IS
 * the shop's identity, and a name beside it only shrinks it. The name shows
 * only for a shop with no logo.
 */
import Link from 'next/link';
import { StoreLogo } from '@/components/storefront/layout/store-logo';
import { useStorefront } from '@/lib/storefront/context';

export function StoreWordmark() {
  const { org } = useStorefront();

  return (
    <Link href="/" className="flex items-center" aria-label={`${org.name} — home`}>
      {org.logoUrl ? (
        <StoreLogo src={org.logoUrl} darkSrc={org.logoDarkUrl} alt="" className="h-9 w-auto max-w-40 object-contain" />
      ) : (
        <span className="font-display text-lg leading-none">{org.name}</span>
      )}
    </Link>
  );
}
