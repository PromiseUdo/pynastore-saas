// @vitest-environment jsdom
/*
 * One component owns the route and the words for "search by image", so the
 * hero, the search sheet and the header's own search box can't drift into
 * three different labels for the same page.
 */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ImageSearchLink } from './image-search-link';
import { VISUAL_SEARCH_PATH } from '@/lib/storefront/visual-search/query';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe('ImageSearchLink', () => {
  it('always points at the one visual search page', () => {
    for (const variant of ['pill', 'row', 'quiet', 'icon'] as const) {
      const { container } = render(<ImageSearchLink variant={variant} />);
      expect(container.querySelector('a')?.getAttribute('href')).toBe(VISUAL_SEARCH_PATH);
      cleanup();
    }
  });

  it('shows its words where there is room for them', () => {
    render(<ImageSearchLink variant="pill" />);
    expect(screen.getByText('Search by image')).toBeTruthy();
  });

  it('keeps them as its accessible name in the header’s search box', () => {
    /* No room for words beside the input — but the icon still has to say
     * what it is to a screen reader. */
    const { container } = render(<ImageSearchLink variant="icon" />);
    expect(container.textContent).toBe('');
    expect(screen.getByLabelText('Search by image')).toBeTruthy();
  });
});
