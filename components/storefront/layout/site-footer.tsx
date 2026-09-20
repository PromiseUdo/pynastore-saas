'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useStorefront } from '@/lib/storefront/context';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { NewsletterSignup } from './newsletter-signup';

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
 */
export interface FooterColumn {
  title: string;
  links: { label: string; href: string }[];
}

export function SiteFooter({
  columns,
  paymentNote = null,
}: {
  columns: FooterColumn[];
  /** how this store's checkout takes payment (lib/storefront/store-claims.ts); null says nothing */
  paymentNote?: string | null;
}) {
  const { org } = useStorefront();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-16 border-t bg-muted/30">
      <div className="sf-container grid gap-10 py-12 lg:grid-cols-[1.4fr_2fr]">
        <div className="max-w-sm">
          <p className="font-display text-lg font-semibold">{org.name}</p>
          <NewsletterSignup className="mt-5" />
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
            * cards work is Squad's decision, not something this app checks. */}
          {paymentNote && <p className="text-center sm:text-right">{paymentNote}</p>}
        </div>
      </div>
    </footer>
  );
}
