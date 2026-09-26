/*
 * lib/storefront/cart.ts
 *
 * The cart's rules, as pure functions. No React, no zustand, no
 * localStorage — the store (lib/storefront/stores/cart-store.ts) is a thin
 * shell around this file, which is what makes the whole cart testable
 * without rendering anything and replaceable without touching the UI.
 *
 * Three jobs live here:
 *
 *  1. LINE IDENTITY. A cart line is a product *variant*, not a product:
 *     "Black / 42" and "Black / 43" are two lines, and adding "Black / 42"
 *     twice is one line of quantity two. `lineKey` is the only place that
 *     decides this; nothing else may compare items by hand.
 *
 *  2. SANITISATION. localStorage is user-writable and survives deploys, so
 *     everything read back is treated as hostile: anything that isn't a
 *     well-formed line is dropped rather than allowed to crash a render.
 *
 *  3. RECONCILIATION. The stored line carries a price/title/image snapshot
 *     so the cart renders instantly, but that snapshot is never authoritative.
 *     `reconcileCart` re-derives every line from the catalogue and reports
 *     what changed. Today the catalogue is fixtures; tomorrow it is the
 *     backend, and only the caller that supplies the products changes.
 *
 * Money is minor units (kobo) throughout — see lib/storefront/pricing.ts,
 * which owns every sum. Nothing in this file adds up money.
 */
import type { CartItem, Product } from './types';
import { optionSummary, variantImage } from './product-helpers';

/** Bumped when the persisted shape changes; older payloads are discarded. */
export const CART_STORAGE_VERSION = 1;

/** Hard ceiling per line, so a corrupt or scripted quantity can't run away. */
export const MAX_LINE_QUANTITY = 99;

/**
 * The identity of a cart line: product + variant.
 *
 * Variant ids are unique per product rather than globally, so the product id
 * is part of the key. Callers address lines by this string and never by
 * index or by variant id alone.
 */
export function lineKey(item: Pick<CartItem, 'productId' | 'variantId'>): string {
  return `${item.productId}::${item.variantId}`;
}

export function sameLine(a: Pick<CartItem, 'productId' | 'variantId'>, b: Pick<CartItem, 'productId' | 'variantId'>): boolean {
  return lineKey(a) === lineKey(b);
}

/**
 * Clamp a quantity into [1, ceiling].
 *
 * Never returns 0: reaching zero through a stepper is an accidental delete,
 * so removing a line is its own explicit action (see `removeItem`).
 */
export function normalizeQuantity(quantity: number, max = MAX_LINE_QUANTITY): number {
  if (!Number.isFinite(quantity)) return 1;
  const ceiling = Math.min(max > 0 ? Math.floor(max) : 1, MAX_LINE_QUANTITY);
  return Math.min(Math.max(1, Math.floor(quantity)), Math.max(1, ceiling));
}

function isPositiveMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Whether an unknown value read back from storage is a usable cart line. */
export function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CartItem>;
  return (
    nonEmptyString(item.productId) &&
    nonEmptyString(item.productSlug) &&
    nonEmptyString(item.variantId) &&
    nonEmptyString(item.name) &&
    nonEmptyString(item.currency) &&
    isPositiveMoney(item.unitPrice) &&
    typeof item.quantity === 'number' &&
    Number.isFinite(item.quantity) &&
    item.quantity > 0
  );
}

/**
 * Make an arbitrary value safe to render as a cart.
 *
 * Drops malformed lines, repairs missing-but-optional fields, clamps
 * quantities, and merges duplicate keys (which a hand-edited payload or an
 * older buggy write could contain) into one line.
 */
export function sanitizeCartItems(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];

  const byKey = new Map<string, CartItem>();
  for (const raw of value) {
    if (!isCartItem(raw)) continue;
    const maxQuantity = isPositiveMoney(raw.maxQuantity) && raw.maxQuantity > 0 ? Math.floor(raw.maxQuantity) : MAX_LINE_QUANTITY;
    const item: CartItem = {
      productId: raw.productId,
      productSlug: raw.productSlug,
      variantId: raw.variantId,
      name: raw.name,
      brandName: nonEmptyString(raw.brandName) ? raw.brandName : '',
      imageUrl: nonEmptyString(raw.imageUrl) ? raw.imageUrl : '',
      optionSummary: typeof raw.optionSummary === 'string' ? raw.optionSummary : '',
      unitPrice: Math.round(raw.unitPrice),
      compareAtPrice: isPositiveMoney(raw.compareAtPrice) ? Math.round(raw.compareAtPrice) : null,
      quantity: normalizeQuantity(raw.quantity, maxQuantity),
      maxQuantity,
      currency: raw.currency,
      /* A bag stored before this rule existed has no flag; false is the safe
       * reading, because the server re-checks the real terms either way. */
      requiresPrepayment: raw.requiresPrepayment === true,
      addedAt: typeof raw.addedAt === 'number' && Number.isFinite(raw.addedAt) ? raw.addedAt : Date.now(),
    };

    const key = lineKey(item);
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity = normalizeQuantity(existing.quantity + item.quantity, existing.maxQuantity);
    } else {
      byKey.set(key, item);
    }
  }

  return [...byKey.values()];
}

/* ---------------- adding ---------------- */

/** Everything needed to build a line, minus the bits the cart derives. */
export type CartLineInput = Omit<CartItem, 'addedAt' | 'quantity'>;

/** Build a cart line from a product + variant. The one place a snapshot is taken. */
export function toCartLine(product: Product, variantId: string): CartLineInput | null {
  const variant = product.variants.find((v) => v.id === variantId);
  if (!variant) return null;

  return {
    productId: product.id,
    productSlug: product.slug,
    variantId: variant.id,
    name: product.name,
    brandName: product.brandName,
    imageUrl: variantImage(product, variant.id),
    optionSummary: optionSummary(product, variant.optionValueIds),
    unitPrice: variant.price,
    compareAtPrice: variant.compareAtPrice,
    maxQuantity: variant.stock,
    currency: product.currency,
    requiresPrepayment: product.requiresPrepayment,
  };
}

/**
 * Add a line to a list of lines, immutably.
 *
 * Same key → quantity goes up (capped at stock). New key → appended, so the
 * cart reads in the order things were added.
 */
export function addLine(items: CartItem[], input: CartLineInput, quantity = 1): CartItem[] {
  const key = lineKey(input);
  const existing = items.find((i) => lineKey(i) === key);

  if (existing) {
    return items.map((i) =>
      lineKey(i) === key ? { ...i, quantity: normalizeQuantity(i.quantity + quantity, input.maxQuantity) } : i,
    );
  }

  return [
    ...items,
    { ...input, quantity: normalizeQuantity(quantity, input.maxQuantity), addedAt: Date.now() },
  ];
}

/* ---------------- reconciliation ---------------- */

export type CartNoticeKind = 'removed' | 'out-of-stock' | 'quantity-reduced' | 'price-changed';

export interface CartNotice {
  kind: CartNoticeKind;
  key: string;
  name: string;
  /** for 'quantity-reduced' / 'price-changed': what it was and what it is now */
  from?: number;
  to?: number;
}

export interface ReconcileResult {
  items: CartItem[];
  notices: CartNotice[];
  /** true when anything at all differs from what was stored */
  changed: boolean;
}

/**
 * Re-derive a cart against the catalogue.
 *
 * The snapshot in storage may be weeks old: the product may be gone, the
 * variant retired, the price moved, the stock down. This returns the cart as
 * the catalogue says it should be, plus a plain-language list of what it had
 * to change, which the cart page shows the shopper.
 *
 * `products` is whatever the caller could resolve. A product that is simply
 * ABSENT from the list is left alone (the lookup may have failed, and
 * silently emptying someone's cart because a fetch timed out is much worse
 * than showing a stale line); pass `{ authoritative: true }` when the list is
 * known to be complete and missing really does mean deleted.
 */
export function reconcileCart(
  items: CartItem[],
  products: Product[],
  { authoritative = false }: { authoritative?: boolean } = {},
): ReconcileResult {
  const byId = new Map(products.map((p) => [p.id, p]));
  const next: CartItem[] = [];
  const notices: CartNotice[] = [];

  for (const item of items) {
    const key = lineKey(item);
    const product = byId.get(item.productId);

    if (!product) {
      if (authoritative) {
        notices.push({ kind: 'removed', key, name: item.name });
        continue;
      }
      next.push(item);
      continue;
    }

    const variant = product.variants.find((v) => v.id === item.variantId);
    if (!variant) {
      notices.push({ kind: 'removed', key, name: item.name });
      continue;
    }

    if (variant.stock <= 0) {
      notices.push({ kind: 'out-of-stock', key, name: item.name });
      continue;
    }

    let quantity = item.quantity;
    if (quantity > variant.stock) {
      notices.push({ kind: 'quantity-reduced', key, name: item.name, from: quantity, to: variant.stock });
      quantity = variant.stock;
    }

    if (variant.price !== item.unitPrice) {
      notices.push({ kind: 'price-changed', key, name: item.name, from: item.unitPrice, to: variant.price });
    }

    next.push({
      ...item,
      ...toCartLine(product, variant.id),
      quantity: normalizeQuantity(quantity, variant.stock),
    });
  }

  const changed =
    notices.length > 0 ||
    next.length !== items.length ||
    next.some((item, i) => item.unitPrice !== items[i]?.unitPrice || item.quantity !== items[i]?.quantity);

  return { items: next, notices, changed };
}

/** One sentence per notice, for the cart page's banner. */
export function describeNotice(notice: CartNotice): string {
  switch (notice.kind) {
    case 'removed':
      return `${notice.name} is no longer available and was removed from your bag.`;
    case 'out-of-stock':
      return `${notice.name} sold out and was removed from your bag.`;
    case 'quantity-reduced':
      return `Only ${notice.to} of ${notice.name} left — your quantity was reduced.`;
    case 'price-changed':
      return `The price of ${notice.name} changed since you added it.`;
  }
}
