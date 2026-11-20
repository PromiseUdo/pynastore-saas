// @vitest-environment jsdom
/*
 * "See all" under a band: named, centred below, and only when the page it
 * opens has more than the band shows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Product } from '@/lib/storefront/types';

vi.mock('@/components/storefront/product/product-card', () => ({
  ProductCard: ({ product }: { product: Product }) => <div>{product.name}</div>,
}));

const { ProductGrid } = await import('./product-grid');
const { ProductFeature } = await import('./product-feature');

afterEach(cleanup);

const products = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `Product ${i}` }) as Product);

describe('a product grid’s See all', () => {
  it('sits under the grid, named for where it goes', () => {
    render(<ProductGrid title="On sale" href="/products?tag=sale" linkLabel="See all sale items" total={12} products={products} />);
    const links = screen.getAllByRole('link', { name: /see all/i });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/products?tag=sale');
    expect(links[0].textContent).toBe('See all sale items');
  });

  it('isn’t there when the band already shows everything', () => {
    render(<ProductGrid title="On sale" href="/products?tag=sale" total={4} products={products} />);
    expect(screen.queryByRole('link', { name: /see all/i })).toBeNull();
  });
});

describe('a feature band’s See all', () => {
  it('counts the products the band actually shows', () => {
    const six = [...products, { id: 'p4', name: 'Product 4' } as Product, { id: 'p5', name: 'Product 5' } as Product];
    // Six products, five shown: there's more to see.
    render(<ProductFeature title="Picks" href="/collections/picks" total={6} products={six} />);
    expect(screen.getByRole('link', { name: /see all/i }).getAttribute('href')).toBe('/collections/picks');
    cleanup();

    render(<ProductFeature title="Picks" href="/collections/picks" total={4} products={products} />);
    expect(screen.queryByRole('link', { name: /see all/i })).toBeNull();
  });
});
