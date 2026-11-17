// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CategoryWithCounts } from '@/features/inventory/actions';
import { CategorySelect } from './CategorySelect';

beforeAll(() => {
  // jsdom has neither; Radix and the list's scroll-into-view use them.
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const cat = (id: string, name: string, parentId: string | null = null, sortOrder = 0) =>
  ({ id, name, slug: id, parentId, sortOrder }) as unknown as CategoryWithCounts;

const categories = [
  cat('women', 'Women', null, 0),
  cat('women-edp', 'Eau de Parfum', 'women', 0),
  cat('arabian', 'Arabian & oil perfumes', null, 1),
  cat('oud', 'Oud', 'arabian', 0),
  cat('attar', 'Perfume oils (attar)', 'arabian', 1),
];

describe('CategorySelect', () => {
  it('finds a category by any part of its path and chooses it with Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CategorySelect id="c" categories={categories} value={null} onChange={onChange} noneLabel="Uncategorised" />);

    await user.click(screen.getByRole('button', { name: /uncategorised/i }));
    await user.keyboard('oud');

    const rows = screen.getAllByRole('option');
    expect(rows.map((r) => r.textContent)).toEqual(['Arabian & oil perfumes › Oud']);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('oud');
  });

  it('matches every word typed, in any order, ignoring case', async () => {
    const user = userEvent.setup();
    render(<CategorySelect id="c" categories={categories} value={null} onChange={() => {}} noneLabel="Uncategorised" />);
    await user.click(screen.getByRole('button'));
    await user.keyboard('PARFUM women');
    expect(screen.getAllByRole('option').map((r) => r.textContent)).toEqual(['Women › Eau de Parfum']);
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    render(<CategorySelect id="c" categories={categories} value={null} onChange={() => {}} noneLabel="Uncategorised" />);
    await user.click(screen.getByRole('button'));
    await user.keyboard('shoes');
    expect(screen.getByText(/no categories match/i)).toBeTruthy();
  });

  it('shows a disabled row with its reason and will not choose it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CategorySelect
        id="c"
        categories={categories}
        value={null}
        onChange={onChange}
        noneLabel="Top level"
        disabledReason={(c) => (c.id === 'oud' ? 'Already added' : null)}
      />,
    );
    await user.click(screen.getByRole('button'));
    const oud = screen.getByRole('option', { name: /oud/i });
    expect(oud.getAttribute('aria-disabled')).toBe('true');
    expect(oud.textContent).toContain('Already added');
    await user.click(oud);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the current choice on the button and marks it in the list', async () => {
    const user = userEvent.setup();
    render(<CategorySelect id="c" categories={categories} value="attar" onChange={() => {}} noneLabel="Uncategorised" />);
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('Arabian & oil perfumes › Perfume oils (attar)');
    await user.click(button);
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('attar');
  });
});
