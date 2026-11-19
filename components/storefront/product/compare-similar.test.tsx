// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PRODUCTS } from '@/lib/storefront/mock/products';
import type { Product } from '@/lib/storefront/types';
import { CompareSimilar, buildRows } from './compare-similar';

afterEach(cleanup);

const base = PRODUCTS[0];
const make = (id: string, over: Partial<Product>): Product => ({ ...base, id, slug: id, name: `Scent ${id}`, ...over });

const VIEWING = make('a', { specs: [{ label: 'Concentration', value: 'Eau de Parfum' }, { label: 'Size', value: '50ml' }], highlights: [] });
const B = make('b', { specs: [{ label: 'Concentration', value: 'Eau de Parfum' }, { label: 'Size', value: '100ml' }], highlights: [] });
const C = make('c', { specs: [{ label: 'Concentration', value: 'Parfum' }], highlights: [] });
const D = make('d', { specs: [], highlights: [] });

const openIt = () => {
  fireEvent.click(screen.getByRole('button', { name: /Compare similar/ }));
  return screen.getByRole('dialog');
};

describe('CompareSimilar', () => {
  it('opens with the product and its two closest matches side by side', () => {
    render(<CompareSimilar product={VIEWING} candidates={[B, C, D]} />);
    const dialog = openIt();
    const headers = within(dialog).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toHaveLength(3);
    expect(headers[0]).toContain('Viewing');
    expect(headers[1]).toContain('Scent b');
    expect(headers[2]).toContain('Scent c');
    // A row per specification any of them lists; a missing one reads "—".
    const size = within(dialog).getByRole('rowheader', { name: 'Size' }).closest('tr')!;
    expect(within(size).getAllByRole('cell').map((c) => c.textContent)).toEqual(['50ml', '100ml', '—']);
  });

  it('allows two at a time, and swaps by removing one first', () => {
    render(<CompareSimilar product={VIEWING} candidates={[B, C, D]} />);
    const dialog = openIt();
    const choice = (name: string) => within(dialog).getByRole('button', { name: new RegExp(name) });
    expect((choice('Scent d') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Scent c from the comparison' }));
    expect((choice('Scent d') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(choice('Scent d'));
    expect(within(dialog).getAllByRole('columnheader').map((h) => h.textContent).join()).toContain('Scent d');
  });

  it('can show only the rows that differ', () => {
    render(<CompareSimilar product={VIEWING} candidates={[B]} />);
    const dialog = openIt();
    expect(within(dialog).getByRole('rowheader', { name: 'Concentration' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Only show differences' }));
    expect(within(dialog).queryByRole('rowheader', { name: 'Concentration' })).toBeNull();
    expect(within(dialog).getByRole('rowheader', { name: 'Size' })).toBeTruthy();
  });

  it('offers nothing when there is nothing similar', () => {
    render(<CompareSimilar product={VIEWING} candidates={[VIEWING]} />);
    expect(screen.queryByRole('button', { name: /Compare similar/ })).toBeNull();
  });

  it('only shows a brand row when one of them has a brand', () => {
    expect(buildRows([{ ...VIEWING, brandName: '' }, { ...B, brandName: ' ' }]).map((r) => r.label)).not.toContain('Brand');
    expect(buildRows([{ ...VIEWING, brandName: 'Aurafume' }, B]).map((r) => r.label)).toContain('Brand');
  });
});
