'use client';

/*
 * Top utility strip — the thin bar above the header.
 *
 * Left: how orders reach the shopper. Centre: secondary entry points.
 * Right: locale, currency and the theme switch. On small screens everything
 * but the delivery line collapses, since the mobile tab bar covers those
 * journeys.
 *
 * The delivery line is built from the merchant's own delivery settings
 * (lib/storefront/store-claims.ts). It used to be a fixed "Nationwide
 * delivery in 2–4 working days" on every store, whatever it had set up. No
 * delivery times here: they differ by area, and the product page and
 * checkout give the real ones.
 *
 * Locale/currency are presentational for now: they render the control and
 * remember the choice locally, but no pricing is converted.
 */
import * as React from 'react';
import Link from 'next/link';
import { ChevronDown,   Truck, Zap, PackageSearch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from './theme-toggle';

/* Only destinations that exist. "Easy Returns" and "Help Center" pointed at
 * policy pages nothing in this app writes yet, so they 404'd. */
const LINKS = [
  { href: '/sale', label: 'Daily Deals', icon: Zap },
  { href: '/track-order', label: 'Track your order', icon: PackageSearch },
];

const LOCALES = ['English', 'Français', 'Yorùbá'];
const CURRENCIES = ['₦ NGN', '$ USD', '£ GBP'];

export function UtilityBar({ deliveryNote = null }: { deliveryNote?: string | null }) {
  return (
    <div className="bg-bar text-[13px] text-white/85">
      <div className="sf-container flex h-10 items-center justify-between gap-4">
        {deliveryNote ? (
          <p className="flex min-w-0 items-center gap-2">
            <Truck className="size-4 shrink-0 text-brand" />
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
                <Icon className="size-4 text-brand" />
                {label}
              </Link>
            </React.Fragment>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          <Picker label="Language" options={LOCALES} className="hidden sm:flex" />
          <Picker label="Currency" options={CURRENCIES} className="hidden sm:flex" />
          <span aria-hidden className="mx-2 hidden h-4 w-px bg-white/15 sm:block" />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

/**
 * A native <select> styled to look like a text button. Using the real control
 * (rather than a custom popover) keeps it keyboard- and screen-reader-correct
 * and gives mobile the OS picker for free.
 */
function Picker({
  label,
  options,
  className,
}: {
  label: string;
  options: string[];
  className?: string;
}) {
  const [value, setValue] = React.useState(options[0]);

  return (
    <span className={cn('relative items-center', className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="cursor-pointer appearance-none rounded-md bg-transparent py-1 pl-2 pr-6 text-[13px] outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand"
      >
        {options.map((o) => (
          // The bar is always dark but the popup is drawn by the OS, so give
          // the options an explicit readable colour pair.
          <option key={o} value={o} className="bg-neutral-900 text-white">
            {o}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-1.5 top-1/2 size-3.5 -translate-y-1/2 opacity-70"
      />
    </span>
  );
}
