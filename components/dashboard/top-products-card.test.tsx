// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TopProductsCard } from './top-products-card';

afterEach(cleanup);

describe('TopProductsCard', () => {
  it('lists the best sellers with what they took and their share in words, linking each product', () => {
    render(
      <TopProductsCard
        currency="NGN"
        top={{
          productCount: 7,
          rows: [
            { productId: 'p1', name: 'Rice (5kg)', unitsSold: 3, revenue: 12_000, shareRatio: 0.8 },
            { productId: null, name: 'Old mug', unitsSold: 1, revenue: 30, shareRatio: 0.002 },
          ],
        }}
      />,
    );
    expect(screen.getByText('7 products sold')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Rice (5kg)' }).getAttribute('href')).toBe('/inventory/products/p1');
    expect(screen.getByText('3 sold · 80% of sales')).toBeTruthy();
    // A deleted product is listed by the name it sold under, without a link.
    expect(screen.queryByRole('link', { name: 'Old mug' })).toBeNull();
    expect(screen.getByText('1 sold · under 1% of sales')).toBeTruthy();
    expect(screen.getByRole('link', { name: /All products/ }).getAttribute('href')).toBe('/reports?view=products&range=7d');
  });

  it('says plainly when nothing sold yet', () => {
    render(<TopProductsCard currency="NGN" top={{ productCount: 0, rows: [] }} />);
    expect(screen.getByText(/Nothing sold in the last 7 days yet/)).toBeTruthy();
  });
});
