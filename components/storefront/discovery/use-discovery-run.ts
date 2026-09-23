'use client';

/*
 * The engine behind every "show me…" on the homepage.
 *
 * Extracted from <DiscoveryHero> when the merchant's own slides were given
 * the option of replacing it: a second surface needed the same behaviour, and
 * two copies of a fetch with its own rate-limit handling, request-supersede
 * guard, scroll and focus management would have drifted apart within a week
 * (AGENTS §9).
 *
 * What it owns, and why each part is not obvious:
 *   - ONE in-flight request. A fast second search must not be overwritten by
 *     a slow first one landing late, so every response checks it is still the
 *     current one.
 *   - the scroll to the results heading, which cannot be
 *     `scrollIntoView({ block: 'nearest' })`: the results are taller than the
 *     screen, so from a tile further down the page `nearest` only scrolls
 *     until the list's BOTTOM edge is in view, and it knows nothing about the
 *     sticky header covering whatever lands at the top. The header is
 *     measured rather than hardcoded because its height differs by breakpoint.
 *   - moving focus to the answer, so a keyboard or screen-reader user is
 *     taken to it rather than left on the input.
 */
import * as React from 'react';
import { useStorefront } from '@/lib/storefront/context';
import type { DiscoveryResult } from './discovery-results';

export type DiscoveryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; result: DiscoveryResult };

export function useDiscoveryRun() {
  const { org } = useStorefront();
  const [state, setState] = React.useState<DiscoveryState>({ status: 'idle' });
  const [heading, setHeading] = React.useState<string | undefined>();
  const resultsRef = React.useRef<HTMLDivElement>(null);
  const requestId = React.useRef(0);

  const scrollToResults = React.useCallback(() => {
    const el = resultsRef.current;
    if (!el) return;
    const header = document.querySelector<HTMLElement>('[data-sf-header]');
    const offset = (header?.getBoundingClientRect().height ?? 0) + 16;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    if (Math.abs(window.scrollY - top) < 4) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, top), behavior: reduced ? 'auto' : 'smooth' });
  }, []);

  const run = React.useCallback(
    async (body: Record<string, unknown>, label?: string) => {
      const id = ++requestId.current;
      setState({ status: 'loading' });
      setHeading(label);
      /* Scroll now, not when the answer lands: a tile tapped far down the
       * page should show its loading state immediately. The results' top edge
       * doesn't move when they finish (everything that changes is below it),
       * so this one scroll still ends on the heading. */
      requestAnimationFrame(scrollToResults);

      try {
        const res = await fetch('/api/storefront/discover', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ org: org.slug, limit: 8, ...body }),
        });

        if (res.status === 429) {
          // Too many searches: say "slow down", not "the catalogue is broken".
          const payload = await res.json().catch(() => null);
          if (id !== requestId.current) return;
          setState({
            status: 'error',
            message:
              typeof payload?.error === 'string'
                ? payload.error
                : 'You’re searching a little fast. Give it a moment and try again.',
          });
          return;
        }
        if (!res.ok) throw new Error(String(res.status));

        const result: DiscoveryResult = await res.json();
        if (id !== requestId.current) return; // superseded
        setState({ status: 'done', result });

        /* `preventScroll` because the scrolling is ours (above). A fast
         * response can land while that smooth scroll is still running, and
         * the taller results can make the browser's scroll anchoring nudge
         * the page — so settle on the heading once more; a no-op when already
         * there. */
        requestAnimationFrame(() => {
          resultsRef.current?.focus({ preventScroll: true });
          scrollToResults();
        });
      } catch {
        if (id !== requestId.current) return;
        setState({ status: 'error', message: 'We couldn’t reach the catalogue just then.' });
      }
    },
    [org.slug, scrollToResults],
  );

  const reset = React.useCallback(() => {
    requestId.current++;
    setState({ status: 'idle' });
    setHeading(undefined);
  }, []);

  return { state, heading, resultsRef, run, reset, scrollToResults };
}
