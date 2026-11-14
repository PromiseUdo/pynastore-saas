/*
 * "Your invoice" — the link to a trade order's business invoice (ROADMAP 21.6),
 * on the buyer's order page and confirmation. A plain link that opens the
 * printable page in a new tab, so the order stays where it was.
 */
import { FileText } from 'lucide-react';

export function InvoiceLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="inline-flex h-10 items-center gap-2 rounded-[var(--sf-radius-button,999px)] border border-border bg-card px-4 text-sm font-semibold transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <FileText className="size-4" aria-hidden />
      Your invoice
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
