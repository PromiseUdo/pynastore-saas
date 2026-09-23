'use client';

/*
 * One line of the bag.
 *
 * A line is a VARIANT, not a product: "Black · 42" and "Black · 43" are two
 * of these, each with its own quantity, and the options are printed under
 * the name because a bag that just says "Nike Air Max" twice is a bag nobody
 * can check.
 *
 * Layout is one row that becomes two on a phone — image left, everything
 * else in a column that can wrap — rather than a table, which is where cart
 * pages usually go wrong on a 390px screen.
 */
import Link from 'next/link';
import Image from 'next/image';
import { ProductImage } from '@/components/storefront/product/product-image';
import { Bookmark, Trash2 } from 'lucide-react';
import { QuantityStepper } from '@/components/storefront/product/quantity-stepper';
import { lineKey } from '@/lib/storefront/cart';
import { formatMoney } from '@/lib/storefront/format';
import { lineSubtotal } from '@/lib/storefront/pricing';
import type { CartItem } from '@/lib/storefront/types';

const LOW_STOCK = 5;

export function CartLineItem({
  item,
  onQuantityChange,
  onRemove,
  onSaveForLater,
}: {
  item: CartItem;
  onQuantityChange: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  onSaveForLater?: (key: string) => void;
}) {
  const key = lineKey(item);
  const label = item.optionSummary ? `${item.name} (${item.optionSummary})` : item.name;

  return (
    <li className="flex gap-4 py-5 first:pt-0">
      <Link href={`/products/${item.productSlug}`} className="shrink-0" aria-hidden tabIndex={-1}>
        <ProductImage
          src={item.imageUrl}
          name={item.name}
          alt=""
          width={112}
          height={140}
          className="h-28 w-24 rounded-xl bg-tile object-cover sm:h-35 sm:w-28"
        />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {item.brandName && (
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{item.brandName}</p>
            )}
            <Link
              href={`/products/${item.productSlug}`}
              className="mt-0.5 line-clamp-2 font-medium leading-snug hover:text-brand"
            >
              {item.name}
            </Link>
            {item.optionSummary && (
              <p className="mt-1 text-sm text-muted-foreground">{item.optionSummary}</p>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              {formatMoney(item.unitPrice, item.currency)} each
            </p>
            {item.maxQuantity <= LOW_STOCK && (
              <p className="mt-1 text-xs font-medium text-sale">Only {item.maxQuantity} left</p>
            )}
          </div>

          {/* The line total sits opposite the name, where a shopper scanning
            * down the right edge can add the bag up themselves. */}
          <p className="shrink-0 text-right font-semibold tabular-nums">
            {formatMoney(lineSubtotal(item), item.currency)}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <QuantityStepper
            value={item.quantity}
            max={item.maxQuantity}
            size="sm"
            itemLabel={label}
            onChange={(next) => onQuantityChange(key, next)}
          />

          {/* Removing is its own button, never "decrease past 1" — that turns
            * a mis-tap into a deletion. */}
          <button
            type="button"
            onClick={() => onRemove(key)}
            aria-label={`Remove ${label} from your bag`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden /> Remove
          </button>

          {onSaveForLater && (
            <button
              type="button"
              onClick={() => onSaveForLater(key)}
              aria-label={`Save ${label} for later`}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-brand"
            >
              <Bookmark className="size-4" aria-hidden /> Save for later
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
