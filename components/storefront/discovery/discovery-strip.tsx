'use client';

/*
 * The discovery tools, without the hero.
 *
 * When a merchant uses their own front-page slides those replace
 * <DiscoveryHero>, and three things went with it: the search box (now always
 * in the header), "Ask the assistant" (now a floating button), and this —
 * guided narrowing, plus the surface that ANSWERS the shopping-mission and
 * budget tiles further down the page.
 *
 * That last part is not a nicety. Those tiles publish a request to the
 * discovery store and the hero was the only thing listening; without a
 * listener, tapping one did nothing at all.
 *
 * Deliberately slim. The merchant's slides are the opening statement here —
 * this is a single line of help underneath, not a second hero competing with
 * the first.
 */
import * as React from 'react';
import { Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDiscoveryStore } from '@/lib/storefront/stores/discovery-store';
import { useDiscoveryRun } from './use-discovery-run';
import { DiscoveryResults } from './discovery-results';
import { GuidedPicker, type GuidedSelection } from './guided-picker';
import { ImageSearchLink } from '@/components/storefront/visual-search/image-search-link';
import type { PriceBandOption, RootCategoryOption } from './types';

export function DiscoveryStrip({
  categories,
  priceBands,
}: {
  categories: RootCategoryOption[];
  priceBands: PriceBandOption[];
}) {
  const [guiding, setGuiding] = React.useState(false);
  const { state, heading, resultsRef, run, reset } = useDiscoveryRun();

  const onGuided = (selection: GuidedSelection) => {
    setGuiding(false);
    void run(
      {
        // A guided pick is already structured, so no text is sent — there is
        // nothing to parse and nothing to misread.
        minPrice: selection.minPrice,
        maxPrice: selection.maxPrice,
        sort: selection.sort,
        q: selection.categoryPath?.at(-1),
      },
      selection.summary || 'your picks',
    );
  };

  /*
   * Missions and budget bands are server-rendered and publish their query to
   * the discovery store rather than navigating. `nonce` is the trigger so
   * tapping the same tile twice re-runs it; the request is cleared once
   * consumed, so a back-navigation doesn't replay it.
   */
  const pending = useDiscoveryStore((s) => s.request);
  const nonce = useDiscoveryStore((s) => s.nonce);
  const clearPending = useDiscoveryStore((s) => s.clear);

  React.useEffect(() => {
    if (!pending) return;
    const { label, ...body } = pending;
    setGuiding(false);
    void run(body, label);
    clearPending();
    // `pending` is intentionally omitted: `nonce` is the trigger, and
    // including the object would re-fire on every unrelated store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  return (
    <section className="sf-container pt-6">
      {/*
        * One row on every width. On a phone the prompt is dropped and the
        * image-search label becomes its icon — the two actions then fit side
        * by side instead of wrapping onto a second line, which read as two
        * unrelated things rather than one offer of help.
        */}
      <div className="flex items-center gap-2">
        <span className="mr-1 hidden text-sm text-muted-foreground sm:inline">
          Not sure where to start?
        </span>

        <button
          type="button"
          onClick={() => setGuiding((open) => !open)}
          aria-expanded={guiding}
          className={cn(
            'inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors sm:flex-none sm:px-5',
            guiding
              ? 'border-brand text-brand'
              : 'border-border hover:border-brand hover:text-brand',
          )}
        >
          {guiding ? (
            <X aria-hidden className="size-4" />
          ) : (
            <Sparkles aria-hidden className="size-4" />
          )}
          {guiding ? 'Close' : 'Help me choose'}
        </button>

        {/* The fourth way in. It lives in the header's search box too, but a
         * shopper who has just landed is looking down here.
         *
         * Two elements, one of which is always `display:none` — so the
         * hidden one is not a second tab stop, and neither is read twice. */}
        <ImageSearchLink className="hidden sm:inline-flex" />
        <ImageSearchLink
          variant="icon"
          className="size-11 shrink-0 border border-border hover:border-brand sm:hidden"
        />
      </div>

      {guiding && (
        <div className="mt-5 max-w-3xl">
          <GuidedPicker
            categories={categories}
            priceBands={priceBands}
            onSubmit={onGuided}
            onCancel={() => setGuiding(false)}
          />
        </div>
      )}

      {/*
       * tabIndex -1 so focus can be moved here once results land. The ring is
       * cleared explicitly: globals.css applies `ring-2` to every
       * :focus-visible, which Chrome matches on programmatic focus too, and
       * an `outline-none` cannot cancel a ring (it's a box-shadow).
       */}
      <div
        ref={resultsRef}
        tabIndex={-1}
        className="outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
      >
        <DiscoveryResults state={state} heading={heading} onReset={reset} />
      </div>
    </section>
  );
}
