'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useStorefront } from '@/lib/storefront/context';
import { ChevronRight, Mail, MapPin, Phone, Smartphone, type LucideIcon } from 'lucide-react';
import { PaymentBadges } from '@/components/storefront/payment/payment-badges';
import type { PaymentMethodOption } from '@/lib/storefront/checkout/types';
import type { SocialPlatform } from '@/lib/storefront/social-links';
import { StoreLogo } from './store-logo';
import { PoweredBy } from './powered-by';
import { SocialGlyph } from './social-glyph';
import { mapsHref } from '@/lib/storefront/maps';

/*
 * WHAT THIS FOOTER MAY LINK TO.
 *
 * Every entry here has to reach a real page, so the shop column is the
 * merchant's OWN departments (passed in from the catalogue) rather than a
 * hardcoded guess at "Fashion, Electronics, Home & Living, Beauty" — a store
 * selling none of those used to have four 404s down here.
 *
 * The Help and About columns are the merchant's own store pages (Settings →
 * Store pages), passed in only once published. There is no built-in
 * "Shipping & returns", "Terms" or "Privacy": those pages are the
 * merchant's words and often their legal position, and the template copy
 * that used to fill them made promises about delivery, returns and payment
 * that nothing in the app enforced.
 *
 * The brand column is how to reach the shop: the contact details and social
 * profiles the merchant entered in Settings → General, each shown only when
 * filled in (ROADMAP 15.0). The address, phone and email sit under the social
 * links in the shop's own column (not a strip of their own), each only when
 * the merchant gave it.
 *
 * Desktop only: on a phone the Account tab carries the same pages and
 * contact details (ROADMAP 16.5). There is no newsletter sign-up — the one that sat
 * here saved nothing, and promised a discount no merchant had offered.
 */
export interface FooterColumn {
  title: string;
  links: { label: string; href: string }[];
}

export interface FooterContact {
  email: string | null;
  phone: string | null;
  address: string | null;
}

export function SiteFooter({
  columns,
  paymentMethods = [],
  contact = { email: null, phone: null, address: null },
  social = [],
  appHref = null,
}: {
  columns: FooterColumn[];
  /** the ways this store's checkout takes payment — shown as badges; none says nothing */
  paymentMethods?: PaymentMethodOption[];
  contact?: FooterContact;
  social?: { platform: SocialPlatform; label: string; url: string }[];
  /** "Get our app", when the store's own app is listed (ROADMAP 16.4) */
  appHref?: string | null;
}) {
  const { org, isMobileRuntime } = useStorefront();
  const year = new Date().getFullYear();

  // Under "Follow us": the address from Business details (opens in Maps for
  // directions), then phone and email — each only when the shop gave it.
  const reach: { icon: LucideIcon; label: string; value: string; href: string; newTab?: boolean }[] = [];
  if (contact.address) reach.push({ icon: MapPin, label: 'Address', value: contact.address, href: mapsHref(contact.address), newTab: true });
  if (contact.phone) reach.push({ icon: Phone, label: 'Phone', value: contact.phone, href: `tel:${contact.phone.replace(/[^\d+]/g, '')}` });
  if (contact.email) reach.push({ icon: Mail, label: 'Email', value: contact.email, href: `mailto:${contact.email}` });

  return (
    <footer className="mt-16 hidden border-t bg-muted/30 lg:block">
      <div className="sf-container grid grid-cols-12 gap-10 py-12">
        <div className="col-span-4 flex flex-col items-start gap-6">
          {/* The shop's own logo — the light or dark one for the current
            * theme, same as the header — and its name only when there's none. */}
          <Link href="/" className="inline-flex" aria-label={org.logoUrl ? `${org.name} home` : undefined}>
            {org.logoUrl ? (
              <StoreLogo
                src={org.logoUrl}
                darkSrc={org.logoDarkUrl}
                alt={org.name}
                className="h-12 w-auto max-w-48 object-contain object-left"
              />
            ) : (
              <span className="font-display text-xl font-semibold">{org.name}</span>
            )}
          </Link>

          {social.length > 0 && (
            <nav aria-label={`${org.name} on social media`}>
              <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Follow us</p>
              <ul className="flex flex-wrap gap-2">
                {social.map((link) => (
                  <li key={link.platform}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${link.label} (opens in a new tab)`}
                      title={link.label}
                      className="flex size-9 items-center justify-center rounded-full border bg-card text-foreground/80 transition-colors hover:border-brand hover:bg-brand hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <SocialGlyph platform={link.platform} />
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {reach.length > 0 && (
            <div>
              <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Visit or contact us</p>
              <ul className="space-y-2.5 text-sm">
                {reach.map(({ icon: Icon, label, value, href, newTab }) => (
                  <li key={label}>
                    <a
                      href={href}
                      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      aria-label={`${label}: ${value}${newTab ? ' (opens in a new tab)' : ''}`}
                      className="group flex max-w-xs items-start gap-2.5 text-muted-foreground transition-colors hover:text-brand"
                    >
                      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
                      <span className="whitespace-pre-line break-words">{value}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {appHref && !isMobileRuntime && (
            <Link
              href={appHref}
              className="group flex w-full max-w-72 items-center gap-3 rounded-2xl border bg-card px-4 py-3 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand text-primary-foreground">
                <Smartphone className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Get our app</span>
                <span className="block truncate text-xs text-muted-foreground">{org.name} on your phone</span>
              </span>
              <ChevronRight aria-hidden className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>

        <nav
          aria-label="Footer"
          className={cn(
            'col-span-8 grid gap-8',
            columns.length <= 2 && 'grid-cols-2',
            columns.length === 3 && 'grid-cols-3',
            columns.length >= 4 && 'grid-cols-4',
          )}
        >
          {columns.map((col) => (
            <div key={col.title}>
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em]">{col.title}</p>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-muted-foreground transition-colors hover:text-brand">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="border-t">
        <div className="sf-container grid grid-cols-[1fr_auto_1fr] items-center gap-6 py-5 text-xs text-muted-foreground">
          <p>© {year} {org.name}. All rights reserved.</p>
          {/* Only what checkout offers this store (components/storefront/payment/payment-badges.tsx). */}
          {paymentMethods.some((m) => m.enabled) ? (
            <PaymentBadges methods={paymentMethods} className="justify-center" />
          ) : (
            <span />
          )}
          <PoweredBy className="justify-self-end" />
        </div>
      </div>
    </footer>
  );
}
