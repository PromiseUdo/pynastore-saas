'use client';

/*
 * "Help me choose", as one modal for the whole shop.
 *
 * Opened from the helper button in the corner (../helper/shop-helper-dock.tsx)
 * or the homepage hero, through `useGuidedStore`. Three questions, then the
 * real products they narrow to — shown here in the modal, so the shopper
 * never loses the page they were on. Each product links to its own page, and
 * going there closes the modal.
 *
 * The answers are the same structured query the homepage used before
 * (department, what matters, budget → /api/storefront/discover), so nothing
 * about which products come back has changed — only where they are shown.
 */
import * as React from 'react';
import { usePathname } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { DialogContent, DialogDescription, DialogRoot, DialogTitle } from '@/components/ui/dialog';
import { useStorefront } from '@/lib/storefront/context';
import { useGuidedStore } from '@/lib/storefront/stores/guided-store';
import { DiscoveryResults } from './discovery-results';
import { GuidedPicker, type GuidedSelection } from './guided-picker';
import { useDiscoveryRun } from './use-discovery-run';
import type { PriceBandOption, RootCategoryOption } from './types';

export function GuidedDialog({
  categories,
  priceBands,
}: {
  categories: RootCategoryOption[];
  priceBands: PriceBandOption[];
}) {
  const { org } = useStorefront();
  const open = useGuidedStore((s) => s.open);
  const setOpen = useGuidedStore((s) => s.setOpen);
  const { state, heading, resultsRef, run, reset } = useDiscoveryRun({ scroll: false });
  // A new key starts the questions again from the first one.
  const [round, setRound] = React.useState(0);
  const pathname = usePathname();

  const startOver = React.useCallback(() => {
    reset();
    setRound((r) => r + 1);
  }, [reset]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) startOver();
  };

  // Tapping a product goes to its page; the modal shouldn't follow it there.
  const lastPath = React.useRef(pathname);
  React.useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (useGuidedStore.getState().open) {
      setOpen(false);
      startOver();
    }
  }, [pathname, setOpen, startOver]);

  const onSubmit = (selection: GuidedSelection) => {
    void run(
      {
        // Already structured, so no text is sent: nothing to parse or misread.
        minPrice: selection.minPrice,
        maxPrice: selection.maxPrice,
        sort: selection.sort,
        q: selection.categoryPath?.at(-1),
      },
      selection.summary || 'your picks',
    );
  };

  const showingResults = state.status !== 'idle';

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          'flex max-h-[min(88dvh,52rem)] flex-col gap-0 overflow-hidden rounded-3xl p-0 ' +
          (showingResults ? 'max-w-[min(56rem,calc(100vw-1.5rem))]' : 'max-w-[min(36rem,calc(100vw-1.5rem))]')
        }
      >
        <div className="flex items-center gap-3 border-b px-5 py-4 pr-12 sm:px-6">
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="font-display text-base font-bold">Help me choose</DialogTitle>
            <DialogDescription className="text-xs">
              Three quick questions, then real options from {org.name}.
            </DialogDescription>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-6">
          {showingResults ? (
            <div ref={resultsRef} tabIndex={-1} className="outline-none focus-visible:ring-0 focus-visible:ring-offset-0">
              <DiscoveryResults
                state={state}
                heading={heading}
                onReset={startOver}
                resetLabel="Start over"
                className="mt-0 border-t-0 pt-0"
              />
            </div>
          ) : (
            <GuidedPicker key={round} categories={categories} priceBands={priceBands} onSubmit={onSubmit} />
          )}
        </div>

      </DialogContent>
    </DialogRoot>
  );
}
