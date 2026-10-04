'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useStorefront } from '@/lib/storefront/context';
import { Mail, MapPin, Phone } from 'lucide-react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import type { SocialPlatform } from '@/lib/storefront/social-links';

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
 * filled in (ROADMAP 15.0). There is no newsletter sign-up — the one that sat
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
  paymentNote = null,
  contact = { email: null, phone: null, address: null },
  social = [],
}: {
  columns: FooterColumn[];
  /** how this store's checkout takes payment (lib/storefront/store-claims.ts); null says nothing */
  paymentNote?: string | null;
  contact?: FooterContact;
  social?: { platform: SocialPlatform; label: string; url: string }[];
}) {
  const { org } = useStorefront();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-16 border-t bg-muted/30">
      <div className="sf-container grid gap-10 py-12 lg:grid-cols-[1.4fr_2fr]">
        <div className="max-w-sm">
          <p className="font-display text-lg font-semibold">{org.name}</p>

          {(contact.email || contact.phone || contact.address) && (
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              {contact.email && (
                <li className="flex items-center gap-2">
                  <Mail className="size-4 shrink-0" aria-hidden />
                  <a href={`mailto:${contact.email}`} className="break-all transition-colors hover:text-foreground">
                    {contact.email}
                  </a>
                </li>
              )}
              {contact.phone && (
                <li className="flex items-center gap-2">
                  <Phone className="size-4 shrink-0" aria-hidden />
                  <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="transition-colors hover:text-foreground">
                    {contact.phone}
                  </a>
                </li>
              )}
              {contact.address && (
                <li className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="whitespace-pre-line">{contact.address}</span>
                </li>
              )}
            </ul>
          )}

          {social.length > 0 && (
            <nav aria-label={`${org.name} on social media`} className="mt-5">
              <ul className="flex flex-wrap gap-2">
                {social.map((link) => (
                  <li key={link.platform}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center rounded-[var(--sf-radius-button,999px)] border bg-card px-3 text-xs font-medium transition-colors hover:border-brand hover:text-brand"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>

        {/* desktop columns */}
        <div
          className={cn(
            'hidden grid-cols-2 gap-8 sm:grid',
            columns.length === 3 && 'md:grid-cols-3',
            columns.length >= 4 && 'md:grid-cols-4',
          )}
        >
          {columns.map((col) => (
            <div key={col.title}>
              <p className="mb-3 text-sm font-semibold">{col.title}</p>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* mobile accordion */}
        <Accordion type="multiple" className="sm:hidden">
          {columns.map((col) => (
            <AccordionItem key={col.title} value={col.title}>
              <AccordionTrigger>{col.title}</AccordionTrigger>
              <AccordionContent>
                <ul className="space-y-2">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="text-sm text-muted-foreground hover:text-foreground">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      <div className="border-t">
        <div className="sf-container flex flex-col items-center justify-between gap-3 py-5 text-xs text-muted-foreground sm:flex-row">
          <p>© {year} {org.name}. All rights reserved.</p>
          {/* Only what checkout offers this store. No card-brand badges: which
            * cards work is Paystack's decision, not something this app checks. */}
          {paymentNote && <p className="text-center sm:text-right">{paymentNote}</p>}
        </div>
      </div>
    </footer>
  );
}
