// @vitest-environment jsdom
/*
 * "Shop by category" on a phone: one row that opens into the list, each
 * category with its picture in a circle or a stand-in when it has none.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Category } from '@/lib/storefront/types';

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: { src: string; alt: string }) => <img src={props.src} alt={props.alt} />,
}));

const { CategoryDropdown } = await import('./category-dropdown');

const cat = (id: string, name: string, path: string[], imageUrl = ''): Category => ({
  id,
  slug: path.at(-1)!,
  name,
  parentId: null,
  level: 0,
  path,
  description: '',
  imageUrl,
  featured: true,
});

afterEach(cleanup);

describe('CategoryDropdown', () => {
  const categories = [cat('w', 'Women', ['women'], 'https://example.com/women.jpg'), cat('m', 'Men', ['men'])];

  it('starts closed, showing how many categories there are', () => {
    render(<CategoryDropdown categories={categories} />);
    const toggle = screen.getByRole('button', { name: /browse categories/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('2 categories');
    expect(screen.queryByRole('link', { name: 'Women' })).toBeNull();
  });

  it('opens into links to each category, pictures where there are some', async () => {
    const { container } = render(<CategoryDropdown categories={categories} />);
    await userEvent.click(screen.getByRole('button', { name: /browse categories/i }));
    expect(screen.getByRole('link', { name: 'Women' }).getAttribute('href')).toBe('/c/women');
    expect(screen.getByRole('link', { name: 'Men' }).getAttribute('href')).toBe('/c/men');
    expect(screen.getByRole('link', { name: 'See all products' }).getAttribute('href')).toBe('/products');
    // Women has a picture; Men gets the stand-in, not a broken image.
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('https://example.com/women.jpg');
  });
});
