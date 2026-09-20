'use client';

/*
 * Shared "add to bag" behaviour for cards, quick view and the PDP:
 * validate → push to the cart store → toast → native haptic → optionally
 * open the mini-cart. Keeps the interaction identical everywhere, and keeps
 * the validation in ONE place rather than in three call sites that drift.
 *
 * The store is the persistence boundary (stores/cart-store.ts); this hook is
 * the interaction boundary. When adding to the bag becomes a request, only
 * this file learns about it.
 */
import * as React from 'react';
import { toast } from 'sonner';
import type { Product, ProductVariant } from './types';
import { defaultVariant } from './product-helpers';
import { toCartLine } from './cart';
import { missingOptionLabels } from './variant-selection';
import { useCartStore } from './stores/cart-store';
import { useUIStore } from './stores/ui-store';

async function haptic() {
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* not native — no-op */
  }
}

export interface AddToCartOptions {
  variant?: ProductVariant;
  quantity?: number;
  openDrawer?: boolean;
  /** suppress the toast when the caller shows its own confirmation */
  silent?: boolean;
}

export type AddToCartResult =
  | { ok: true }
  | { ok: false; reason: 'needs-options' | 'out-of-stock' | 'unknown-variant'; message: string };

export function useCartActions() {
  const addItem = useCartStore((s) => s.addItem);
  const openCart = useUIStore((s) => s.openCart);

  /**
   * Add a product to the bag.
   *
   * A product with options REQUIRES an explicit variant: quietly adding
   * whichever colour happened to be first is how a shopper ends up with the
   * wrong thing in their bag, so callers that cannot ask (a product card)
   * must send the shopper somewhere that can (quick view, or the PDP).
   */
  const tryAddToCart = React.useCallback(
    (product: Product, opts: AddToCartOptions = {}): AddToCartResult => {
      const requiresChoice = product.options.length > 0;
      if (requiresChoice && !opts.variant) {
        const missing = missingOptionLabels(product, {});
        return {
          ok: false,
          reason: 'needs-options',
          message: missing.length ? `Please select a ${missing.join(' and ')}.` : 'Please choose an option.',
        };
      }

      const variant = opts.variant ?? defaultVariant(product);
      if (!variant) {
        return { ok: false, reason: 'unknown-variant', message: 'That option is no longer available.' };
      }
      if (variant.stock <= 0) {
        return { ok: false, reason: 'out-of-stock', message: 'Sorry, that option is out of stock.' };
      }

      const line = toCartLine(product, variant.id);
      if (!line) {
        return { ok: false, reason: 'unknown-variant', message: 'That option is no longer available.' };
      }

      addItem(line, opts.quantity ?? 1);

      void haptic();
      if (!opts.silent) {
        toast.success(`${product.name} added to bag`, {
          action: { label: 'View bag', onClick: () => openCart() },
        });
      }
      if (opts.openDrawer ?? true) openCart();
      return { ok: true };
    },
    [addItem, openCart],
  );

  /** Fire-and-forget variant: toasts the failure and reports success as a boolean. */
  const addToCart = React.useCallback(
    (product: Product, opts: AddToCartOptions = {}): boolean => {
      const result = tryAddToCart(product, opts);
      if (!result.ok) {
        toast.error(result.message);
        return false;
      }
      return true;
    },
    [tryAddToCart],
  );

  return { addToCart, tryAddToCart };
}
