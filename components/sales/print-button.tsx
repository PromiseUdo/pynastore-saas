'use client';

import { Printer } from 'lucide-react';

/**
 * "Print / Save as PDF" for a printable document.
 *
 * There is no PDF generator here on purpose: every browser's print dialog
 * already saves to PDF, and it does it with the customer's own paper size
 * and margins. Shipping a headless renderer to produce a slightly different
 * file would be a lot of moving parts for a worse result.
 *
 * `print:hidden` — nobody wants a picture of a button on their invoice.
 */
export function PrintButton({ label = 'Print or save as PDF' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-300 px-3 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 print:hidden"
    >
      <Printer className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}
