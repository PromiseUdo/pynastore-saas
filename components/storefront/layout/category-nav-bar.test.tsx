// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryNavBar } from './category-nav-bar';
import type { NavItem } from '@/lib/storefront/navigation';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: React.ComponentProps<'a'>) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({ src, alt, ...rest }: React.ComponentProps<'img'>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={String(src)} alt={alt ?? ''} {...rest} />
  ),
}));

// The component reads the slug-free path via usePublicPathname(), which
// wraps usePathname() and strips proxy.ts's internal /store/{slug} prefix.
const pathname = vi.fn(() => '/');
vi.mock('@/lib/storefront/use-public-pathname', () => ({
  usePublicPathname: () => pathname(),
}));

function navItem(id: string, name: string): NavItem {
  return {
    id,
    name,
    href: `/c/${id}`,
    description: `All things ${name}`,
    columns: [
      {
        id: `${id}-a`,
        name: `${name} group A`,
        href: `/c/${id}/a`,
        links: [
          { id: `${id}-a1`, name: `${name} leaf one`, href: `/c/${id}/a/1` },
          { id: `${id}-a2`, name: `${name} leaf two`, href: `/c/${id}/a/2` },
        ],
      },
      {
        id: `${id}-b`,
        name: `${name} group B`,
        href: `/c/${id}/b`,
        links: [{ id: `${id}-b1`, name: `${name} leaf three`, href: `/c/${id}/b/1` }],
      },
    ],
    quickLinks: [],
  };
}

const ITEMS: NavItem[] = [
  navItem('electronics', 'Electronics'),
  navItem('fashion', 'Fashion'),
  // A synthetic entry with no subtree — belongs in the primary links, never
  // in the category rail.
  { id: 'sale', name: 'Sale', href: '/sale', columns: [], quickLinks: [] },
];

const panel = () => screen.queryByRole('heading', { level: 3 });

describe('<CategoryNavBar>', () => {
  beforeEach(() => {
    pathname.mockReturnValue('/');
  });

  // vitest.config.ts doesn't set `globals: true`, so RTL never registers its
  // automatic afterEach — without this the previous render stays mounted and
  // every query finds duplicates.
  afterEach(cleanup);

  it('renders the primary links and keeps the dropdown closed initially', () => {
    render(<CategoryNavBar navItems={ITEMS} />);

    expect(screen.getByRole('link', { name: 'New in' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Collections' })).toBeTruthy();
    /* Every primary link must have a route behind it: "Brands", "Our story"
     * and "Contact" were removed because none of them had one. */
    expect(screen.queryByRole('link', { name: 'Brands' })).toBeNull();
    expect(screen.getByRole('button', { name: /^categories$/i }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(panel()).toBeNull();
  });

  it('opens the category panel on click and shows the first root', async () => {
    const user = userEvent.setup();
    render(<CategoryNavBar navItems={ITEMS} />);

    await user.click(screen.getByRole('button', { name: /^categories$/i }));

    expect(panel()?.textContent).toBe('Electronics');
    // leaves are flattened into one grid
    expect(screen.getByRole('link', { name: /Electronics leaf one/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Electronics leaf three/ })).toBeTruthy();
  });

  it('swaps the panel when another root is hovered', async () => {
    const user = userEvent.setup();
    render(<CategoryNavBar navItems={ITEMS} />);
    await user.click(screen.getByRole('button', { name: /^categories$/i }));

    const rail = screen.getByRole('list', { name: 'Categories' });
    await user.hover(within(rail).getByRole('link', { name: /^Fashion/ }));

    expect(panel()?.textContent).toBe('Fashion');
  });

  it('excludes nav entries that have no subtree from the category rail', async () => {
    const user = userEvent.setup();
    render(<CategoryNavBar navItems={ITEMS} />);
    await user.click(screen.getByRole('button', { name: /^categories$/i }));

    const rail = screen.getByRole('list', { name: 'Categories' });
    expect(within(rail).queryByRole('link', { name: 'Sale' })).toBeNull();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<CategoryNavBar navItems={ITEMS} />);
    await user.click(screen.getByRole('button', { name: /^categories$/i }));
    expect(panel()).not.toBeNull();

    await user.keyboard('{Escape}');
    expect(panel()).toBeNull();
  });

  it('marks the current route as the active nav link', () => {
    pathname.mockReturnValue('/sale');
    render(<CategoryNavBar navItems={ITEMS} />);

    expect(screen.getByRole('link', { name: 'Deals' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Collections' }).getAttribute('aria-current')).toBeNull();
  });
});
