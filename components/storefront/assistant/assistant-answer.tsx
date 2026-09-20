'use client';

/*
 * One assistant turn, rendered by response kind.
 *
 * Not a chat bubble (§27). The assistant's words are plain prose in the page
 * flow; what follows them is shopping UI — the storefront's own
 * <ProductCard>, a comparison table, real links. Wrapping a product grid in
 * a speech bubble would make a shopping tool look like a messaging app, and
 * make the cards harder to use at the same time.
 *
 * The cards are the EXACT component the homepage and category pages use
 * (§28), so wishlist, quick view and add-to-bag behave identically here and
 * a product found through the assistant is not a second-class result.
 */
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowUpRight, Info } from 'lucide-react';
import type { AssistantResponse } from '@/lib/ai/assistant/types';
import { ProductCard } from '@/components/storefront/product/product-card';
import { cn } from '@/lib/utils';

export function AssistantAnswer({
  response,
  onAsk,
}: {
  response: AssistantResponse;
  /** send a suggestion / quick reply as the next message */
  onAsk: (message: string) => void;
}) {
  const { kind, message, products, reasons, comparison, suggestions, followUp, actions, total } =
    response;

  return (
    <div className="space-y-4">
      {/* The assistant's own words. An icon plus a muted rule, so a screen
        * reader and a skimming eye both get "this is the answer" without a
        * coloured bubble. */}
      <p
        className={cn(
          'text-[0.9375rem] leading-relaxed',
          kind === 'error' && 'text-destructive',
        )}
      >
        {message}
      </p>

      {/* Products — the storefront's card, two up, wrapping to one on a
        * narrow phone so nothing is squeezed below a usable size. */}
      {products.length > 0 && kind !== 'comparison' && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6">
          {products.map((product) => (
            <div key={product.id}>
              <ProductCard product={product} />
              {reasons[product.id] && (
                <p className="mt-1.5 text-xs text-muted-foreground">{reasons[product.id]}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {total != null && total > products.length && (
        <p className="text-xs text-muted-foreground">
          Showing {products.length} of {total} matches.
        </p>
      )}

      {comparison && <ComparisonTable response={response} />}

      {/* A guiding question with clickable answers (§22). */}
      {followUp && (
        <div className="rounded-xl border bg-secondary/50 p-4">
          <p className="text-sm font-semibold">{followUp.question}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {followUp.options.map((option) => (
              <ChipButton key={option} onClick={() => onAsk(option)}>
                {option}
              </ChipButton>
            ))}
          </div>
        </div>
      )}

      {/* Navigation and re-ask actions. Nothing here mutates an order,
        * a payment method or an account (§15). */}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) =>
            action.kind === 'navigate' && action.href ? (
              <Link
                key={action.id}
                href={action.href as Route}
                className="inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors hover:border-brand hover:text-brand"
              >
                {action.label}
                <ArrowUpRight aria-hidden className="size-3.5" />
              </Link>
            ) : (
              <ChipButton key={action.id} onClick={() => onAsk(action.message ?? action.label)}>
                {action.label}
              </ChipButton>
            ),
          )}
        </div>
      )}

      {suggestions.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">You could ask</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <ChipButton key={suggestion} onClick={() => onAsk(suggestion)}>
                {suggestion}
              </ChipButton>
            ))}
          </div>
        </div>
      )}

      {/*
       * Said once per answer, not per claim. The assistant only ever
       * describes rows the catalogue returned, and a shopper is entitled to
       * know that is the limit of what it knows.
       */}
      {(products.length > 0 || kind === 'comparison') && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-3 shrink-0" />
          Based on this store&rsquo;s product listings, prices and customer reviews.
        </p>
      )}
    </div>
  );
}

/**
 * Side-by-side attributes.
 *
 * A table, because that is what this is — and because a table gives screen
 * readers the row/column relationship that a grid of divs throws away. It
 * scrolls horizontally inside its own box so three products never force the
 * panel to scroll sideways (§41).
 */
function ComparisonTable({ response }: { response: AssistantResponse }) {
  const { comparison, products } = response;
  if (!comparison) return null;

  const ordered = comparison.productIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is (typeof products)[number] => Boolean(p));
  if (ordered.length < 2) return null;

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        <caption className="sr-only">
          Listed details for {ordered.map((p) => p.name).join(' and ')}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="w-28 pb-2 text-left text-xs font-medium text-muted-foreground">
              Listed detail
            </th>
            {ordered.map((product) => (
              <th key={product.id} scope="col" className="pb-2 text-left align-bottom">
                <Link
                  href={`/products/${product.slug}` as Route}
                  className="text-sm font-semibold hover:text-brand"
                >
                  {product.name}
                </Link>
                <span className="block text-xs font-normal text-muted-foreground">
                  {product.brandName}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {comparison.rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" className="py-2 pr-3 text-left text-xs font-medium text-muted-foreground">
                {row.label}
              </th>
              {row.values.map((value, i) => (
                <td key={`${row.label}-${comparison.productIds[i]}`} className="py-2 pr-3">
                  {/* An unlisted attribute says so, rather than showing a
                    * blank that reads as "doesn't have it". */}
                  {value ?? <span className="text-muted-foreground">Not listed</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChipButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors hover:border-brand hover:text-brand focus-visible:border-brand"
    >
      {children}
    </button>
  );
}
