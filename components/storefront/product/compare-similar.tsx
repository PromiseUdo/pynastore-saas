'use client';

/*
 * "Compare similar" — the product beside up to two of its closest matches,
 * in a modal, one row per thing a shopper weighs: price, rating, whether it's
 * in stock, brand, every specification any of them lists, and highlights.
 *
 * The products offered are "You may also like" (the Recommendation Service's
 * closest matches for this product), so the two never disagree about what
 * "similar" means. Every cell is the merchant's own field; a product that
 * doesn't list something shows "—" rather than a guess. Nothing here is
 * generated.
 *
 * Two are picked to start with, so the table is useful the moment it opens;
 * the shopper swaps them from the row of choices at the top. "Only show
 * differences" hides the rows where every product says the same thing — the
 * rows that settle a decision are the ones that differ.
 */
import * as React from 'react';
import Link from 'next/link';
import { ArrowRightLeft, Check, Star, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Product } from '@/lib/storefront/types';
import { formatMoney } from '@/lib/storefront/format';
import { DialogContent, DialogDescription, DialogRoot, DialogTitle } from '@/components/ui/dialog';
import { ProductImage } from './product-image';

export const MAX_COMPARED = 2;
const EMPTY = '—';

interface Row {
  label: string;
  cells: React.ReactNode[];
  /** plain values, to tell whether the row differs */
  keys: string[];
}

function priceText(p: Product): string {
  const from = formatMoney(p.priceFrom, p.currency);
  return p.priceTo > p.priceFrom ? `From ${from}` : from;
}

export function buildRows(products: Product[]): Row[] {
  const rows: Row[] = [];
  const push = (label: string, values: (string | null)[], render?: (p: Product, i: number) => React.ReactNode) =>
    rows.push({
      label,
      keys: values.map((v) => v ?? ''),
      cells: products.map((p, i) => (render ? render(p, i) : values[i] || EMPTY)),
    });

  push(
    'Price',
    products.map(priceText),
    (p) => (
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold text-price">{priceText(p)}</span>
        {p.compareAtPrice != null && p.compareAtPrice > p.priceFrom && (
          <span className="text-xs text-muted-foreground line-through">{formatMoney(p.compareAtPrice, p.currency)}</span>
        )}
      </span>
    ),
  );
  push(
    'Rating',
    products.map((p) => (p.rating.count > 0 ? `${p.rating.average.toFixed(1)}/${p.rating.count}` : null)),
    (p) =>
      p.rating.count > 0 ? (
        <span className="inline-flex items-center gap-1">
          <Star aria-hidden className="size-3.5 fill-rating text-rating" />
          <span className="font-semibold">{p.rating.average.toFixed(1)}</span>
          <span className="text-muted-foreground">
            ({p.rating.count} {p.rating.count === 1 ? 'review' : 'reviews'})
          </span>
        </span>
      ) : (
        <span className="text-muted-foreground">No reviews yet</span>
      ),
  );
  push(
    'Availability',
    products.map((p) => (p.inStock ? 'in' : 'out')),
    (p) => (p.inStock ? <span className="text-success">In stock</span> : <span className="text-muted-foreground">Sold out</span>),
  );
  if (products.some((p) => p.brandName?.trim())) {
    push('Brand', products.map((p) => p.brandName?.trim() || null));
  }

  // Every specification any of them lists, in the order they first appear.
  const labels: string[] = [];
  for (const p of products) for (const s of p.specs) if (!labels.includes(s.label)) labels.push(s.label);
  for (const label of labels) {
    push(label, products.map((p) => p.specs.find((s) => s.label === label)?.value?.trim() || null));
  }

  if (products.some((p) => p.highlights.length > 0)) {
    push(
      'Highlights',
      products.map((p) => p.highlights.join('|') || null),
      (p) =>
        p.highlights.length ? (
          <ul className="space-y-1.5">
            {p.highlights.map((h) => (
              <li key={h} className="flex items-start gap-1.5">
                <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-teal" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        ) : (
          EMPTY
        ),
    );
  }
  return rows;
}

export function CompareSimilar({ product, candidates }: { product: Product; candidates: Product[] }) {
  const options = React.useMemo(() => candidates.filter((c) => c.id !== product.id), [candidates, product.id]);
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<string[]>(() => options.slice(0, MAX_COMPARED).map((c) => c.id));
  const [onlyDifferences, setOnlyDifferences] = React.useState(false);

  if (options.length === 0) return null;

  const compared = [product, ...picked.map((id) => options.find((c) => c.id === id)).filter((c): c is Product => !!c)];
  const rows = buildRows(compared);
  const shown = onlyDifferences && compared.length > 1 ? rows.filter((r) => new Set(r.keys).size > 1) : rows;
  const full = picked.length >= MAX_COMPARED;

  const toggle = (id: string) =>
    setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : current.length >= MAX_COMPARED ? current : [...current, id]));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-[var(--sf-radius-button,999px)] border bg-card px-4 text-sm font-medium transition-colors hover:border-brand hover:text-brand"
      >
        <ArrowRightLeft aria-hidden className="size-4 text-teal" />
        Compare similar
      </button>

      <DialogRoot open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[min(90dvh,56rem)] max-w-[min(64rem,calc(100vw-1.5rem))] flex-col gap-0 overflow-hidden rounded-3xl p-0">
          <div className="border-b px-5 py-4 pr-12 sm:px-6">
            <DialogTitle className="font-display text-lg font-bold">Compare similar products</DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">
              Choose up to {MAX_COMPARED} to put beside {product.name}.
            </DialogDescription>

            {/* the choices */}
            <ul className="sf-thin-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Products to compare">
              {options.map((c) => {
                const on = picked.includes(c.id);
                const blocked = !on && full;
                return (
                  <li key={c.id} className="shrink-0">
                    <button
                      type="button"
                      aria-pressed={on}
                      disabled={blocked}
                      title={blocked ? `Remove one to add another — up to ${MAX_COMPARED} at a time` : undefined}
                      onClick={() => toggle(c.id)}
                      className={cn(
                        'flex w-52 items-center gap-2 rounded-2xl border p-1.5 pr-3 text-left text-xs transition-colors',
                        on ? 'border-brand bg-brand/5' : 'bg-card hover:border-brand',
                        blocked && 'cursor-not-allowed opacity-50 hover:border-border',
                      )}
                    >
                      <span className="relative size-10 shrink-0 overflow-hidden rounded-xl bg-tile">
                        <ProductImage src={c.images[0]?.url} alt="" name={c.name} fill sizes="40px" className="object-cover" />
                      </span>
                      <span className="line-clamp-2 min-w-0 flex-1 font-medium">{c.name}</span>
                      <span
                        aria-hidden
                        className={cn(
                          'flex size-5 shrink-0 items-center justify-center rounded-full border',
                          on && 'border-brand bg-brand text-primary-foreground',
                        )}
                      >
                        {on && <Check className="size-3" />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <caption className="sr-only">
                {compared.map((p) => p.name).join(' compared with ')}
              </caption>
              <thead>
                <tr>
                  <td className="sticky left-0 z-10 w-28 min-w-28 bg-card px-4 py-4 align-bottom sm:w-36 sm:min-w-36 sm:px-6">
                    {compared.length > 1 && (
                      <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={onlyDifferences}
                          onChange={(e) => setOnlyDifferences(e.target.checked)}
                          className="mt-0.5 size-4 accent-[var(--brand)]"
                        />
                        Only show differences
                      </label>
                    )}
                  </td>
                  {compared.map((p, i) => (
                    <th key={p.id} scope="col" className="min-w-40 px-3 py-4 text-left align-top font-normal sm:min-w-52">
                      <div className="relative">
                        <div className="relative aspect-square overflow-hidden rounded-2xl bg-tile">
                          <ProductImage src={p.images[0]?.url} alt="" name={p.name} fill sizes="(min-width: 640px) 200px, 160px" className="object-cover" />
                        </div>
                        {i === 0 ? (
                          <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-[0.6875rem] font-semibold">
                            Viewing
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggle(p.id)}
                            aria-label={`Remove ${p.name} from the comparison`}
                            className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-background/90 transition-colors hover:text-brand"
                          >
                            <X aria-hidden className="size-4" />
                          </button>
                        )}
                      </div>
                      <p className="mt-2.5 line-clamp-2 font-semibold leading-snug">{p.name}</p>
                      {i > 0 && (
                        <Link
                          href={`/products/${p.slug}`}
                          onClick={() => setOpen(false)}
                          className="mt-1 inline-block text-xs font-semibold text-brand underline-offset-4 hover:underline"
                        >
                          View product
                        </Link>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.label}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-t bg-card px-4 py-3 text-left align-top text-xs font-medium text-muted-foreground sm:px-6"
                    >
                      {row.label}
                    </th>
                    {row.cells.map((cell, i) => (
                      <td key={compared[i].id} className="border-t px-3 py-3 align-top">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={compared.length + 1} className="border-t px-6 py-6 text-sm text-muted-foreground">
                      These products don’t differ in anything their listings say.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {compared.length === 1 && (
              <p className="px-6 pb-6 text-sm text-muted-foreground">Choose a product above to compare it with this one.</p>
            )}
          </div>
        </DialogContent>
      </DialogRoot>
    </>
  );
}
