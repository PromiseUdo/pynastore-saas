'use client';

/*
 * Variant options.
 *
 * Presentational only — every rule about what is available and what a click
 * does lives in lib/storefront/variant-selection.ts, which is unit-tested.
 *
 * Three accessibility decisions worth keeping:
 *  - Each option group is a radiogroup, so a screen reader announces "Colour,
 *    Black, 2 of 5" and arrow keys work the way they do everywhere else.
 *  - A colour is never communicated by the swatch alone: the chosen label is
 *    printed beside the group name and is the swatch's accessible name.
 *  - Sold-out values stay VISIBLE and focusable, marked `aria-disabled`,
 *    because "this exists but not in your size" is information. Hiding them
 *    just makes the shopper think the store is smaller than it is.
 */
import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { Product } from '@/lib/storefront/types';
import { stockForValue, type Selection } from '@/lib/storefront/variant-selection';
import { hasSizeOption } from '@/lib/storefront/pages/rules';

export function VariantPicker({
  product,
  selection,
  onSelect,
  sizeGuideHref = null,
}: {
  product: Product;
  selection: Selection;
  onSelect: (optionId: string, valueId: string) => void;
  /** the merchant's published size guide — offered beside any size option */
  sizeGuideHref?: string | null;
}) {
  if (!product.options.length) return null;

  return (
    <div className="space-y-5">
      {product.options.map((option) => {
        const selectedId = selection[option.id];
        const selectedLabel = option.values.find((v) => v.id === selectedId)?.label;

        return (
          <div key={option.id}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold">
                {option.name}
                {selectedLabel && (
                  <span className="ml-2 font-normal text-muted-foreground">{selectedLabel}</span>
                )}
              </p>
              {sizeGuideHref && hasSizeOption([option.name]) && (
                /* A new tab, so the shopper comes back to the size they were choosing. */
                <Link
                  href={sizeGuideHref}
                  target="_blank"
                  rel="noopener"
                  className="shrink-0 text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Size guide
                </Link>
              )}
            </div>

            <div
              role="radiogroup"
              aria-label={option.name}
              className={cn('flex flex-wrap gap-2', option.kind === 'color' && 'gap-2.5')}
            >
              {option.values.map((value) => {
                const chosen = selectedId === value.id;
                const stock = stockForValue(product, selection, option.id, value.id);
                const soldOut = stock <= 0;

                const shared = cn(
                  'relative transition focus-visible:outline-none focus-visible:ring-2',
                  'focus-visible:ring-ring focus-visible:ring-offset-2',
                  soldOut && 'opacity-45',
                );

                if (option.kind === 'color') {
                  const swatchImage = product.images.find((i) => i.optionValueId === value.id);
                  return (
                    <button
                      key={value.id}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      aria-disabled={soldOut || undefined}
                      // The label — never the colour alone — names the control.
                      aria-label={`${value.label}${soldOut ? ' (out of stock)' : ''}`}
                      onClick={() => onSelect(option.id, value.id)}
                      className={cn(
                        shared,
                        'size-12 overflow-hidden rounded-full ring-offset-2',
                        chosen ? 'ring-2 ring-brand' : 'ring-1 ring-border hover:ring-foreground/40',
                      )}
                    >
                      {swatchImage ? (
                        <Image src={swatchImage.url} alt="" fill sizes="48px" className="object-cover" />
                      ) : (
                        <span
                          aria-hidden
                          className="block size-full"
                          style={{ background: value.swatch ?? 'var(--muted)' }}
                        />
                      )}
                      {soldOut && (
                        <span
                          aria-hidden
                          className="absolute inset-0 flex items-center justify-center"
                        >
                          <span className="h-px w-10 rotate-45 bg-foreground/70" />
                        </span>
                      )}
                    </button>
                  );
                }

                return (
                  <button
                    key={value.id}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    aria-disabled={soldOut || undefined}
                    aria-label={soldOut ? `${value.label} (out of stock)` : undefined}
                    onClick={() => onSelect(option.id, value.id)}
                    className={cn(
                      shared,
                      // 44px minimum: these are tapped far more than clicked.
                      'h-12 min-w-12 rounded-xl border px-4 text-sm font-medium',
                      chosen
                        ? 'border-brand bg-brand text-primary-foreground'
                        : 'hover:border-foreground/40',
                      soldOut && !chosen && 'line-through',
                    )}
                  >
                    {value.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
