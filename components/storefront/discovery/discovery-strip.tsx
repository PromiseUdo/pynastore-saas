'use client';

/*
 * What answers the homepage's shopping-mission and budget tiles when the
 * merchant's own slides have taken the discovery hero's place.
 *
 * Those tiles publish a request to the discovery store and something on the
 * page has to listen; without a listener, tapping one did nothing at all.
 * This is that listener, and the results it shows — nothing else.
 *
 * It used to carry a row of "Help me choose", "Search by image" and the
 * assistant too. Those now live in the helper button in the corner of every
 * page (components/storefront/helper/shop-helper-dock.tsx), so a row here
 * would only repeat it under the merchant's slides.
 */
import * as React from 'react';
import { useDiscoveryStore } from '@/lib/storefront/stores/discovery-store';
import { useDiscoveryRun } from './use-discovery-run';
import { DiscoveryResults } from './discovery-results';

export function DiscoveryStrip() {
  const { state, heading, resultsRef, run, reset } = useDiscoveryRun();

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
    void run(body, label);
    clearPending();
    // `pending` is intentionally omitted: `nonce` is the trigger, and
    // including the object would re-fire on every unrelated store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  return (
    <section className="sf-container">
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
