/*
 * The cart's rules, tested without a browser or a component.
 *
 * These are the parts that are wrong in ways a screenshot won't show: two
 * sizes of the same shoe silently collapsing into one line, a hand-edited
 * localStorage payload taking the storefront down, a quantity surviving a
 * sold-out restock. Everything here runs against the real fixture catalogue.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_LINE_QUANTITY,
  addLine,
  lineKey,
  normalizeQuantity,
  reconcileCart,
  sanitizeCartItems,
  toCartLine,
} from './cart';
import { cartItemCount, cartSubtotal } from './pricing';
import { PRODUCTS } from './mock/products';
import type { CartItem, Product } from './types';

/** A fixture product with at least two in-stock variants. */
const multi = PRODUCTS.find((p) => p.options.length > 0 && p.variants.filter((v) => v.stock > 1).length >= 2)!;
/** A fixture product with no options at all. */
const simple = PRODUCTS.find((p) => p.options.length === 0 && p.variants[0]?.stock > 1)!;

function line(product: Product, variantId: string, quantity = 1): CartItem {
  return { ...toCartLine(product, variantId)!, quantity, addedAt: Date.now() };
}

describe('line identity', () => {
  it('keys a line by product AND variant', () => {
    const [a, b] = multi.variants;
    expect(lineKey({ productId: multi.id, variantId: a.id })).not.toBe(
      lineKey({ productId: multi.id, variantId: b.id }),
    );
    expect(lineKey({ productId: 'p1', variantId: 'v1' })).toBe(lineKey({ productId: 'p1', variantId: 'v1' }));
  });
});

describe('addLine', () => {
  it('adds a product to the cart', () => {
    const items = addLine([], toCartLine(simple, simple.variants[0].id)!, 1);
    expect(items).toHaveLength(1);
    expect(items[0].productId).toBe(simple.id);
    expect(items[0].quantity).toBe(1);
  });

  it('increases quantity when the same product/variant is added twice', () => {
    const input = toCartLine(simple, simple.variants[0].id)!;
    const items = addLine(addLine([], input, 1), input, 2);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
  });

  it('keeps different variants of one product as separate lines', () => {
    const [a, b] = multi.variants.filter((v) => v.stock > 0);
    const items = addLine(addLine([], toCartLine(multi, a.id)!, 1), toCartLine(multi, b.id)!, 1);
    expect(items).toHaveLength(2);
    expect(new Set(items.map(lineKey)).size).toBe(2);
  });

  it('never exceeds the stock of the line', () => {
    const variant = simple.variants[0];
    const items = addLine([], toCartLine(simple, variant.id)!, variant.stock + 50);
    expect(items[0].quantity).toBe(Math.min(variant.stock, MAX_LINE_QUANTITY));
  });

  it('returns null for a variant that does not exist', () => {
    expect(toCartLine(simple, 'nope')).toBeNull();
  });
});

describe('normalizeQuantity', () => {
  it('never goes below 1', () => {
    expect(normalizeQuantity(0, 10)).toBe(1);
    expect(normalizeQuantity(-4, 10)).toBe(1);
  });

  it('clamps to the ceiling and to whole numbers', () => {
    expect(normalizeQuantity(99, 5)).toBe(5);
    expect(normalizeQuantity(2.7, 10)).toBe(2);
  });

  it('survives nonsense', () => {
    expect(normalizeQuantity(Number.NaN, 10)).toBe(1);
    expect(normalizeQuantity(Infinity, 10)).toBe(1);
    expect(normalizeQuantity(5, 0)).toBe(1);
  });
});

describe('totals', () => {
  it('sums line totals into a subtotal', () => {
    const items = [line(simple, simple.variants[0].id, 2), line(multi, multi.variants[0].id, 1)];
    expect(cartSubtotal(items)).toBe(items[0].unitPrice * 2 + items[1].unitPrice);
  });

  it('counts units, not lines', () => {
    const items = [line(simple, simple.variants[0].id, 2), line(multi, multi.variants[0].id, 1)];
    expect(cartItemCount(items)).toBe(3);
  });

  it('is zero for an empty cart', () => {
    expect(cartSubtotal([])).toBe(0);
    expect(cartItemCount([])).toBe(0);
  });
});

describe('sanitizeCartItems', () => {
  it('drops anything that is not an array', () => {
    expect(sanitizeCartItems(null)).toEqual([]);
    expect(sanitizeCartItems('{"items":1}')).toEqual([]);
    expect(sanitizeCartItems({ items: [] })).toEqual([]);
  });

  it('drops malformed lines but keeps good ones', () => {
    const good = line(simple, simple.variants[0].id, 1);
    const result = sanitizeCartItems([good, { productId: 'x' }, null, 42, { ...good, unitPrice: 'free' }]);
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe(simple.id);
  });

  it('repairs quantities instead of trusting them', () => {
    const bad = { ...line(simple, simple.variants[0].id, 1), quantity: 9_999, maxQuantity: 4 };
    expect(sanitizeCartItems([bad])[0].quantity).toBe(4);
  });

  it('merges duplicate keys into one line', () => {
    const a = line(simple, simple.variants[0].id, 1);
    const result = sanitizeCartItems([a, { ...a }]);
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(2);
  });
});

describe('reconcileCart', () => {
  it('leaves a healthy cart alone', () => {
    const items = [line(simple, simple.variants[0].id, 1)];
    const result = reconcileCart(items, [simple], { authoritative: true });
    expect(result.notices).toEqual([]);
    expect(result.items).toHaveLength(1);
  });

  it('removes a product that is gone from the catalogue', () => {
    const items = [line(simple, simple.variants[0].id, 1)];
    const result = reconcileCart(items, [], { authoritative: true });
    expect(result.items).toEqual([]);
    expect(result.notices[0].kind).toBe('removed');
  });

  it('keeps a line when the lookup was not authoritative', () => {
    const items = [line(simple, simple.variants[0].id, 1)];
    expect(reconcileCart(items, []).items).toHaveLength(1);
  });

  it('removes a variant that no longer exists', () => {
    const items = [{ ...line(simple, simple.variants[0].id, 1), variantId: 'retired' }];
    const result = reconcileCart(items, [simple]);
    expect(result.items).toEqual([]);
    expect(result.notices[0].kind).toBe('removed');
  });

  it('removes a line that sold out', () => {
    const soldOut: Product = {
      ...simple,
      variants: simple.variants.map((v) => ({ ...v, stock: 0 })),
    };
    const result = reconcileCart([line(simple, simple.variants[0].id, 1)], [soldOut]);
    expect(result.items).toEqual([]);
    expect(result.notices[0].kind).toBe('out-of-stock');
  });

  it('reduces a quantity that outran the stock', () => {
    const scarce: Product = {
      ...simple,
      variants: simple.variants.map((v, i) => (i === 0 ? { ...v, stock: 1 } : v)),
    };
    const result = reconcileCart([line(simple, simple.variants[0].id, 5)], [scarce]);
    expect(result.items[0].quantity).toBe(1);
    expect(result.notices[0]).toMatchObject({ kind: 'quantity-reduced', from: 5, to: 1 });
  });

  it('takes the catalogue price over the stored one, and says so', () => {
    const stale = { ...line(simple, simple.variants[0].id, 1), unitPrice: 1 };
    const result = reconcileCart([stale], [simple]);
    expect(result.items[0].unitPrice).toBe(simple.variants[0].price);
    expect(result.notices.some((n) => n.kind === 'price-changed')).toBe(true);
  });
});
