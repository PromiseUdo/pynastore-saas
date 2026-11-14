// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SalesTrendChart } from './sales-trend-chart';
import type { SalesTrend } from '@/features/dashboard/overview';

afterEach(cleanup);

const trend = (sales: number[], previous: number[]): SalesTrend => {
  const days = sales.map((value, i) => ({
    day: `2026-11-${String(i + 1).padStart(2, '0')}`,
    sales: value,
    orders: value > 0 ? 1 : 0,
    previousDay: `2026-10-${String(i + 1).padStart(2, '0')}`,
    previousSales: previous[i] ?? 0,
  }));
  return {
    days,
    total: sales.reduce((a, b) => a + b, 0),
    orders: days.reduce((a, d) => a + d.orders, 0),
    previousTotal: previous.reduce((a, b) => a + b, 0),
  };
};

describe('SalesTrendChart', () => {
  it('leads with the total and says how it compares, in words', () => {
    render(<SalesTrendChart trend={trend([10_000, 20_000, 30_000], [20_000, 20_000])} currency="NGN" />);
    expect(screen.getByText('₦60,000')).toBeTruthy();
    expect(screen.getByText(/Up 50%/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Sales report/ }).getAttribute('href')).toBe('/reports?view=sales&range=30d');
    // A bar a day, each one focusable with its figures.
    expect(screen.getAllByLabelText(/from 1 order/)).toHaveLength(3);
  });

  it('says plainly when there’s nothing yet, instead of an empty chart', () => {
    render(<SalesTrendChart trend={trend([0, 0], [0, 0])} currency="NGN" />);
    expect(screen.getByText(/No sales in the last 60 days yet/)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
