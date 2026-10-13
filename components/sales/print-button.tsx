'use client';

import * as React from 'react';
import { Printer, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { inBusinessApp } from '@/lib/business-app/client';
import { shareContent } from '@/lib/business-app/share';

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
export function PrintButton({ label = 'Print or save as PDF', share }: { label?: string; share?: { title: string; text: string } }) {
  /* The business app (ROADMAP 19.4): a phone's WebView can't print, and a
   * receipt goes to the customer on WhatsApp anyway — so there it's shared
   * as text through the phone's share sheet. Decided after mount. */
  const [inApp, setInApp] = React.useState(false);
  React.useEffect(() => setInApp(inBusinessApp()), []);

  if (inApp && share) {
    return (
      <button
        type="button"
        onClick={async () => {
          if (!(await shareContent(share))) toast.error('We couldn’t open sharing. Please try again.');
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-300 px-3 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 print:hidden"
      >
        <Share2 className="size-3.5" aria-hidden />
        Share
      </button>
    );
  }

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
