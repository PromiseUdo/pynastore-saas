'use client';

/*
 * The homepage centrepiece: "tell us what you need" rather than "here's the
 * catalogue, go dig".
 *
 * Four ways in, all resolving against the same catalogue:
 *   • type or describe it        → lib/ai/intent.ts → real catalogue query
 *   • Ask the assistant          → lib/ai/assistant → a conversation that
 *                                  can be refined turn by turn (§17)
 *   • Help me choose             → guided narrowing, same query shape
 *   • Search by image            → /search/image, a discovery method of its
 *                                  own rather than a panel bolted on here
 *
 * The search box and the assistant are deliberately different tools rather
 * than one box that guesses: a typed query returns a grid in place, which is
 * what most visitors want, and the assistant is there for the requests that
 * need a back-and-forth ("something more premium", "only jewellery"). What
 * is typed carries over when the assistant is opened, so nothing is retyped.
 *
 * Kept compact on purpose. A full-bleed editorial hero looks good in a
 * screenshot but pushes the actual shopping tool below the fold; here the
 * input, the three routes in and the first shopping missions all land in the
 * first viewport.
 *
 * This is the only client component in the homepage's upper half. Every
 * product band below it stays server-rendered.
 */
import * as React from 'react';
import { Loader2, MessagesSquare, Search, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStorefront } from '@/lib/storefront/context';
import { useDiscoveryStore } from '@/lib/storefront/stores/discovery-store';
import { DiscoveryResults, type DiscoveryResult } from './discovery-results';
import { GuidedPicker, type GuidedSelection } from './guided-picker';
import { ImageSearchLink } from '@/components/storefront/visual-search/image-search-link';
import { useAssistantStore } from '@/lib/storefront/stores/assistant-store';
import type { PriceBandOption, RootCategoryOption } from './types';

type Mode = 'search' | 'guided';
type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; result: DiscoveryResult };

export function DiscoveryHero({
  categories,
  priceBands,
  examples,
}: {
  categories: RootCategoryOption[];
  priceBands: PriceBandOption[];
  /** real, catalogue-derived example phrasings */
  examples: string[];
}) {
  const { org } = useStorefront();
  const [mode, setMode] = React.useState<Mode>('search');
  const [q, setQ] = React.useState('');
  const [state, setState] = React.useState<State>({ status: 'idle' });
  const [heading, setHeading] = React.useState<string | undefined>();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const resultsRef = React.useRef<HTMLDivElement>(null);

  // One in-flight request at a time: a fast second search must not be
  // overwritten by a slow first one landing late.
  const requestId = React.useRef(0);

  /*
   * Brings the top of the results — the "N matches for …" heading — to just
   * under the sticky header.
   *
   * Not `scrollIntoView({ block: 'nearest' })`: the results are taller than
   * the screen, so from a tile further down the page `nearest` only scrolls
   * until the list's BOTTOM edge is in view, and it knows nothing about the
   * sticky header covering whatever does land at the top. The header's height
   * is measured rather than hardcoded because it differs by breakpoint (the
   * category bar only exists from lg).
   */
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
      // Scroll now, not when the answer lands: a tile tapped far down the page
      // should show its loading state immediately. The results' top edge
      // doesn't move when they finish (everything that changes is below it),
      // so this one scroll still ends on the heading.
      requestAnimationFrame(scrollToResults);
      try {
        const res = await fetch('/api/storefront/discover', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ org: org.slug, limit: 8, ...body }),
        });
        if (res.status === 429) {
          // Too many searches: say "slow down", not "the catalogue is broken".
          const body = await res.json().catch(() => null);
          if (id !== requestId.current) return;
          setState({
            status: 'error',
            message:
              typeof body?.error === 'string'
                ? body.error
                : 'You’re searching a little fast. Give it a moment and try again.',
          });
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const result: DiscoveryResult = await res.json();
        if (id !== requestId.current) return; // superseded
        setState({ status: 'done', result });
        // Move focus to the results so a keyboard/screen-reader user is taken
        // to the answer rather than left on the input. `preventScroll` because
        // the scrolling is ours (above). A fast response can land while that
        // smooth scroll is still running, and the taller results can make the
        // browser's scroll anchoring nudge the page — so settle on the heading
        // once more; it is a no-op when already there.
        requestAnimationFrame(() => {
          resultsRef.current?.focus({ preventScroll: true });
          scrollToResults();
        });
      } catch {
        if (id !== requestId.current) return;
        setState({
          status: 'error',
          message: 'We couldn’t reach the catalogue just then.',
        });
      }
    },
    [org.slug, scrollToResults],
  );

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    setMode('search');
    void run({ q: text }, `“${text}”`);
  };

  const onGuided = (selection: GuidedSelection) => {
    setMode('search');
    void run(
      {
        // A guided pick is already structured, so no text is sent — there is
        // nothing to parse and nothing to misread.
        mission: undefined,
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
   * the discovery store rather than navigating (see <DiscoveryTrigger>).
   * `nonce` is in the dependency list so tapping the same tile twice re-runs
   * it; the request is cleared once consumed so a back-navigation doesn't.
   */
  const pending = useDiscoveryStore((s) => s.request);
  const nonce = useDiscoveryStore((s) => s.nonce);
  const clearPending = useDiscoveryStore((s) => s.clear);

  React.useEffect(() => {
    if (!pending) return;
    const { label, ...body } = pending;
    setMode('search');
    setQ(pending.q ?? '');
    void run(body, label);
    clearPending();
    // `pending` is intentionally omitted: `nonce` is the trigger, and
    // including the object would re-fire on every unrelated store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const reset = () => {
    requestId.current++;
    setState({ status: 'idle' });
    setHeading(undefined);
    setQ('');
  };

  /*
   * Hand whatever has been typed to the assistant as its opening message, so
   * "a gift for my girlfriend under ₦50k" is answered immediately and can
   * then be refined ("something more premium", "only jewellery") without the
   * shopper starting again.
   */
  const openAssistant = useAssistantStore((s) => s.openPanel);
  const askAssistant = () => {
    const text = q.trim();
    openAssistant({ surface: 'home', initialMessage: text || undefined }, org.slug);
  };

  return (
    <section className="sf-container pb-2 pt-6 lg:pb-6 lg:pt-14">
      <div className="mx-auto max-w-3xl text-center">
        {/* <p className="inline-flex items-center gap-2 rounded-full bg-teal-soft px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-teal">
          <Sparkles aria-hidden className="size-3.5" />
          Shop by describing it
        </p> */}

        <h1 className="mt-5 text-[1.875rem] leading-[1.12] sm:text-5xl lg:text-[3.5rem]">
          What are you looking for?
        </h1>

        <p className="mx-auto mt-4 max-w-lg text-[0.9375rem] leading-relaxed text-muted-foreground lg:text-base">
          Describe what you need in your own words — or let {org.name} narrow it
          down for you.
        </p>

        {/* ── the tool ─────────────────────────────────────────────────── */}
        <form onSubmit={onSearch} role="search" className="mt-7">
          <label htmlFor="sf-discovery-input" className="sr-only">
            Search products, or describe what you need
          </label>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card p-1.5 pl-5 shadow-sm shadow-foreground/5 transition-colors focus-within:border-brand">
            <Search
              aria-hidden
              className="size-5 shrink-0 text-muted-foreground"
            />
            <input
              ref={inputRef}
              id="sf-discovery-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search or describe what you need…"
              autoComplete="off"
              // min-w-0 lets the input shrink instead of pushing the button out
              className="h-12 min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-muted-foreground"
            />
            {/* Deliberately not `disabled` when empty: this is the page's
             * primary call to action and a greyed-out button is the first
             * thing a visitor would see. Submitting empty is a no-op. */}
            <button
              type="submit"
              className="flex h-12 shrink-0 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover sm:px-7"
            >
              {state.status === 'loading' && mode === 'search' ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Search aria-hidden className="size-4 sm:hidden" />
              )}
              <span className="max-sm:sr-only">Search</span>
            </button>
          </div>
        </form>

        {/* ── the other two ways in ────────────────────────────────────── */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
          <SecondaryAction
            active={false}
            onClick={askAssistant}
            icon={<MessagesSquare className="size-4" />}
          >
            Ask the assistant
          </SecondaryAction>
          <SecondaryAction
            active={mode === 'guided'}
            onClick={() => setMode(mode === 'guided' ? 'search' : 'guided')}
            icon={<Sparkles className="size-4" />}
          >
            Help me choose
          </SecondaryAction>
          {/* A real link to a real page: visual search is one of the
            * store's discovery methods, not a panel that lives in the hero. */}
          <ImageSearchLink />
        </div>

        {/* Real phrasings built from this store's own catalogue. */}
        {mode === 'search' &&
          state.status === 'idle' &&
          examples.length > 0 && (
            <p className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-sm text-muted-foreground">
              <span className="shrink-0">Try:</span>
              {examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setQ(ex);
                    void run({ q: ex }, `“${ex}”`);
                  }}
                  className="rounded-full border border-border px-3 py-1 text-xs font-medium transition-colors hover:border-brand hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </p>
          )}
      </div>

      {mode === 'guided' && (
        <div className="mx-auto mt-8 max-w-3xl">
          <GuidedPicker
            categories={categories}
            priceBands={priceBands}
            onSubmit={onGuided}
            onCancel={() => setMode('search')}
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

function SecondaryAction({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-11 items-center gap-2 rounded-full border px-5 text-sm font-semibold transition-colors',
        active
          ? 'border-brand bg-brand text-primary-foreground'
          : 'border-border hover:border-brand',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
