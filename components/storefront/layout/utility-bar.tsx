'use client';

/*
 * Top utility strip — the thin bar above the header.
 *
 * Left: how orders reach the shopper. Centre: secondary entry points.
 * Right: the theme switch. On small screens the links collapse, since the
 * mobile tab bar covers those journeys.
 *
 * The delivery line is built from the merchant's own delivery settings
 * (lib/storefront/store-claims.ts). It used to be a fixed "Nationwide
 * delivery in 2–4 working days" on every store, whatever it had set up. No
 * delivery times here: they differ by area, and the product page and
 * checkout give the real ones.
 *
 * The icons take the strip's own text colour, not the brand colour: the
 * strip is always dark, and a store whose brand colour is black or another
 * dark shade (most light looks) had icons that vanished into it.
 *
 * No language or currency picker: the store is in English and prices are in
 * naira only, and a picker that changes nothing would be a false promise.
 */
import * as React from 'react';
import Link from 'next/link';
import { Truck, Zap, PackageSearch } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';

/* Only destinations that exist. "Easy Returns" and "Help Center" pointed at
 * policy pages nothing in this app writes yet, so they 404'd. */
const LINKS = [
  { href: '/sale', label: 'Daily Deals', icon: Zap },
  { href: '/track-order', label: 'Track your order', icon: PackageSearch },
];

export function UtilityBar({ deliveryNote = null }: { deliveryNote?: string | null }) {
  return (
    <div className="bg-bar text-[13px] text-white/85">
      <div className="sf-container flex h-10 items-center justify-between gap-4">
        {deliveryNote ? (
          <p className="flex min-w-0 items-center gap-2">
            <Truck className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{deliveryNote}</span>
          </p>
        ) : (
          <span aria-hidden />
        )}

        <nav className="hidden items-center lg:flex">
          {LINKS.map(({ href, label, icon: Icon }, i) => (
            <React.Fragment key={href}>
              {i > 0 && <span aria-hidden className="mx-4 h-4 w-px bg-white/15" />}
              <Link
                href={href}
                className="flex items-center gap-2 transition-colors hover:text-white"
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            </React.Fragment>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
