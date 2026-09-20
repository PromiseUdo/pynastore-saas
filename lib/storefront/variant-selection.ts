/*
 * lib/storefront/variant-selection.ts
 *
 * The rules behind a variant picker, as pure functions.
 *
 * They live outside the component because they are the part that can be
 * wrong in ways a screenshot won't show: which combinations exist, which are
 * out of stock, what happens to the rest of the selection when a shopper
 * changes their mind about colour, and how much of a thing they are allowed
 * to buy. A component that owns these rules can only be tested by rendering
 * it; a function can be tested directly — see product-detail.test.ts.
 *
 * Shared by the PDP and available to quick view. No React, no 'use client':
 * this is equally callable from a Server Component or a test.
 */
import type { Product, ProductVariant } from './types';

/** option id → selected option-value id */
export type Selection = Record<string, string>;

/** The variant matching a complete selection, or null if it isn't complete. */
export function resolveVariant(product: Product, selection: Selection): ProductVariant | null {
  const ids = product.options.map((option) => selection[option.id]).filter(Boolean);
  if (ids.length !== product.options.length) return null;

  return (
    product.variants.find(
      (variant) =>
        variant.optionValueIds.length === ids.length &&
        ids.every((id) => variant.optionValueIds.includes(id)),
    ) ?? null
  );
}

/**
 * The selection a product opens on: the first IN-STOCK variant, falling back
 * to the first variant so an entirely sold-out product still renders its
 * options rather than an empty picker.
 */
export function initialSelection(product: Product): Selection {
  const variant = product.variants.find((v) => v.stock > 0) ?? product.variants[0];
  if (!variant) return {};

  const selection: Selection = {};
  for (const option of product.options) {
    const match = option.values.find((value) => variant.optionValueIds.includes(value.id));
    if (match) selection[option.id] = match.id;
  }
  return selection;
}

/**
 * Stock for one option value, given what else is currently selected.
 *
 * The other options are held fixed, which is what makes "Black is sold out in
 * M" expressible: the same colour can be available under a different size.
 * Returns the total stock across every variant that matches, so 0 means
 * genuinely unavailable rather than merely unselected.
 */
export function stockForValue(
  product: Product,
  selection: Selection,
  optionId: string,
  valueId: string,
): number {
  const constraints = product.options
    .filter((option) => option.id !== optionId && selection[option.id])
    .map((option) => selection[option.id]);

  return product.variants
    .filter(
      (variant) =>
        variant.optionValueIds.includes(valueId) &&
        constraints.every((id) => variant.optionValueIds.includes(id)),
    )
    .reduce((total, variant) => total + variant.stock, 0);
}

/**
 * Apply a click on an option value.
 *
 * If the new combination doesn't exist (or is sold out), the OTHER options
 * are relaxed one at a time to the nearest in-stock combination that keeps
 * the value just chosen. A shopper who taps "Navy" asked for navy; leaving
 * them on a dead combination and making them hunt for the size that revives
 * it is the failure mode this avoids.
 */
export function selectValue(
  product: Product,
  selection: Selection,
  optionId: string,
  valueId: string,
): Selection {
  const next: Selection = { ...selection, [optionId]: valueId };

  const candidate = resolveVariant(product, next);
  if (candidate && candidate.stock > 0) return next;

  // Prefer an in-stock variant carrying the chosen value; settle for any.
  const carrying = product.variants.filter((v) => v.optionValueIds.includes(valueId));
  const best = carrying.find((v) => v.stock > 0) ?? carrying[0];
  if (!best) return next;

  const repaired: Selection = {};
  for (const option of product.options) {
    const match = option.values.find((value) => best.optionValueIds.includes(value.id));
    if (match) repaired[option.id] = match.id;
  }
  return repaired;
}

/** How many of the current selection a shopper may buy. */
export function maxQuantity(product: Product, variant: ProductVariant | null): number {
  if (variant) return variant.stock;
  // No options at all → the single variant carries the stock.
  if (!product.options.length) return product.variants[0]?.stock ?? 0;
  // Incomplete selection: nothing to add yet.
  return 0;
}

/**
 * Keep a quantity inside [1, stock].
 *
 * Never returns 0 for an in-stock product — a stepper that can reach zero
 * silently means "remove", which is a cart interaction, not a PDP one.
 */
export function clampQuantity(quantity: number, stock: number): number {
  if (!Number.isFinite(quantity)) return 1;
  const ceiling = stock > 0 ? stock : 1;
  return Math.min(Math.max(1, Math.floor(quantity)), ceiling);
}

/** Whether the current selection can be added to the bag. */
export function canAddToCart(product: Product, variant: ProductVariant | null): boolean {
  if (product.options.length && !variant) return false;
  return maxQuantity(product, variant) > 0;
}

/** The price to show for the current selection, falling back to the range's floor. */
export function selectedPrice(product: Product, variant: ProductVariant | null): number {
  return variant?.price ?? product.priceFrom;
}

/** The compare-at price for the current selection, or null when not on offer. */
export function selectedCompareAt(product: Product, variant: ProductVariant | null): number | null {
  const compareAt = variant ? variant.compareAtPrice : product.compareAtPrice;
  const price = selectedPrice(product, variant);
  return compareAt != null && compareAt > price ? compareAt : null;
}

/** The image index to show for a selection — a colour choice moves the gallery. */
export function imageIndexForSelection(product: Product, selection: Selection): number | null {
  const chosen = Object.values(selection);
  const index = product.images.findIndex(
    (image) => image.optionValueId && chosen.includes(image.optionValueId),
  );
  return index >= 0 ? index : null;
}

/**
 * The options a shopper still has to choose, by label ("size", "colour").
 *
 * Feeds the message under a disabled Add to bag button: "Please select a
 * size" is actionable in a way that a greyed-out button is not.
 */
export function missingOptionLabels(product: Product, selection: Selection): string[] {
  return product.options.filter((option) => !selection[option.id]).map((option) => option.name.toLowerCase());
}
