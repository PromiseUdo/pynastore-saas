import { describe, expect, it } from 'vitest';
import { stripStorefrontPrefix } from '@/lib/storefront/use-public-pathname';

const SLUG = 'pynacode';

describe('stripStorefrontPrefix', () => {
  it('strips the subdomain storefront rewrite prefix', () => {
    expect(stripStorefrontPrefix(`/store/${SLUG}/cart`, SLUG)).toBe('/cart');
    expect(stripStorefrontPrefix(`/store/${SLUG}/c/fashion/women`, SLUG)).toBe('/c/fashion/women');
  });

  it('strips the mobile-origin prefix', () => {
    expect(stripStorefrontPrefix(`/s/${SLUG}/cart`, SLUG)).toBe('/cart');
  });

  it('collapses a bare prefix to the root', () => {
    expect(stripStorefrontPrefix(`/store/${SLUG}`, SLUG)).toBe('/');
    expect(stripStorefrontPrefix(`/s/${SLUG}`, SLUG)).toBe('/');
  });

  it('leaves an already-public path untouched', () => {
    expect(stripStorefrontPrefix('/', SLUG)).toBe('/');
    expect(stripStorefrontPrefix('/cart', SLUG)).toBe('/cart');
  });

  it('does not strip another tenant’s prefix', () => {
    expect(stripStorefrontPrefix('/store/other/cart', SLUG)).toBe('/store/other/cart');
  });

  it('does not strip a partial slug match', () => {
    // `/store/pynacode-labs` must not be read as `/store/pynacode` + `-labs`
    expect(stripStorefrontPrefix(`/store/${SLUG}-labs/cart`, SLUG)).toBe(`/store/${SLUG}-labs/cart`);
  });
});
