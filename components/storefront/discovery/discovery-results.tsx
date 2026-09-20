'use client';

/*
 * The results surface shared by every discovery entry point.
 *
 * Results render IN PLACE rather than navigating away. That is partly a UX
 * choice — the shopper can refine without losing their place — and partly
 * architectural: the listing/search routes (/search, /products, /c/*) don't
 * exist yet, so navigating would 404. Each result still links to its real
 * product page, and `viewAllHref` is emitted so the hand-off works the day
 * those routes land.
 *
 * Every card here is a row the catalogue returned. Nothing on this screen is
 * generated text about a product.
 */
import { Loader2, PackageSearch, SlidersHorizontal } from 'lucide-react';
import type { Product } from '@/lib/storefront/types';
import type { RecognisedConstraint } from '@/lib/ai/types';
import { ProductCard, ProductCardSkeleton } from '@/components/storefront/product/product-card';
import { AssistantLauncher } from '@/components/storefront/assistant/assistant-launcher';

export interface DiscoveryResult {
  products: Product[];
  total: number;
  recognised: RecognisedConstraint[];
  mission: { id: string; label: string } | null;
}

export function DiscoveryResults({
  state,
  heading,
  onReset,
}: {
  state: { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'done'; result: DiscoveryResult };
  heading?: string;
  onReset: () => void;
}) {
  if (state.status === 'idle') return null;

  return (
    <section
      aria-live="polite"
      aria-busy={state.status === 'loading'}
      className="mt-10 border-t border-border pt-8"
    >
      {state.status === 'loading' && (
        <>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Searching the catalogue…
          </p>
          <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        </>
      )}

      {state.status === 'error' && (
        <p className="rounded-2xl bg-secondary p-5 text-sm">
          {state.message}{' '}
          <button onClick={onReset} className="font-semibold underline underline-offset-2">
            Try again
          </button>
        </p>
      )}

      {state.status === 'done' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h3 className="text-lg font-bold">
                {state.result.total > 0
                  ? `${state.result.total} ${state.result.total === 1 ? 'match' : 'matches'}`
                  : 'No matches'}
                {heading ? ` for ${heading}` : ''}
              </h3>

              {/* What the parser actually understood. Shown so the shopper can
                * see why these results came back — and correct us if not. */}
              {state.result.recognised.length > 0 && (
                <ul className="mt-2.5 flex flex-wrap items-center gap-2">
                  <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <SlidersHorizontal className="size-3.5" />
                    <span>Understood as</span>
                  </li>
                  {state.result.recognised.map((r) => (
                    <li
                      key={`${r.kind}-${r.label}`}
                      className="rounded-full bg-teal-soft px-2.5 py-1 text-xs font-medium text-teal"
                    >
                      {r.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              onClick={onReset}
              className="shrink-0 text-sm font-semibold underline underline-offset-4 hover:text-teal"
            >
              Clear
            </button>
          </div>

          {state.result.products.length > 0 ? (
            <div className="mt-7 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
              {state.result.products.map((p, i) => (
                <ProductCard key={p.id} product={p} priority={i < 4} />
              ))}
            </div>
          ) : (
            <div className="mt-6 flex items-start gap-4 rounded-2xl bg-secondary p-6">
              <PackageSearch className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-semibold">Nothing matched all of that.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try removing the budget, or describe it more loosely — “headphones” finds more
                  than “noise-cancelling headphones under ₦10,000”.
                </p>
                {/* The assistant can do the loosening itself: it checks what
                  * relaxing the query actually returns before offering it,
                  * so it never sends the shopper to a second empty page. */}
                <AssistantLauncher
                  className="mt-4"
                  label="Ask the assistant instead"
                  seed={{ surface: 'search', initialMessage: heading?.replace(/[“”]/g, '') }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
