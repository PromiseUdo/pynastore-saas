'use client';

/*
 * "Buy it again".
 *
 * Resolves the order's lines against the catalogue as it is TODAY — through
 * the same /api/storefront/products endpoint everything else uses — and adds
 * back what can still be bought. Anything delisted or sold out is named
 * rather than silently dropped: a bag that quietly comes back one item short
 * is how someone re-orders the wrong thing.
 *
 * Prices are today's, too. Re-ordering is not a promise to honour an old
 * price, and this never pretends otherwise.
 */
import * as React from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useStorefront } from '@/lib/storefront/context';
import { useCartActions } from '@/lib/storefront/use-cart-actions';
import type { Product } from '@/lib/storefront/types';
import type { StorefrontOrder } from '@/lib/storefront/orders/types';

export function ReorderButton({ order }: { order: StorefrontOrder }) {
  const { org } = useStorefront();
  const { tryAddToCart } = useCartActions();
  const [busy, setBusy] = React.useState(false);

  const buyAgain = async () => {
    const ids = [...new Set(order.lines.map((line) => line.productId).filter(Boolean))] as string[];
    if (!ids.length) {
      toast.message('These items aren’t in the store any more.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(
        `/api/storefront/products?ids=${encodeURIComponent(ids.join(','))}&store=${encodeURIComponent(org.slug)}`,
      );
      const data = response.ok ? ((await response.json()) as { products: Product[] }) : { products: [] };
      const byId = new Map(data.products.map((product) => [product.id, product]));

      let added = 0;
      const missing: string[] = [];

      for (const line of order.lines) {
        const product = line.productId ? byId.get(line.productId) : undefined;
        const variant = product?.variants.find((v) => v.id === line.variantId);

        if (!product || !variant || variant.stock < 1) {
          missing.push(line.name);
          continue;
        }

        /* `tryAddToCart`, not `addToCart`: this reports every outcome in one
         * summary at the end, rather than firing a toast per failed line. */
        const result = tryAddToCart(product, {
          variant,
          quantity: Math.min(line.quantity, variant.stock),
          silent: true,
        });
        if (result.ok) added += 1;
        else missing.push(line.name);
      }

      if (added === 0) {
        toast.error('None of these are available right now.');
      } else if (missing.length > 0) {
        toast.success(`Added ${added} back to your bag. Not available: ${missing.join(', ')}.`);
      } else {
        toast.success('Added back to your bag, at today’s prices.');
      }
    } catch {
      toast.error('We couldn’t reach the store just then. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={buyAgain}
      disabled={busy}
      className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-medium transition-colors hover:border-brand hover:text-brand disabled:opacity-60"
    >
      <RotateCcw className="size-4" aria-hidden />
      {busy ? 'Adding…' : 'Buy it again'}
    </button>
  );
}
