// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/lib/storefront/context', () => ({
  useStorefront: () => ({ org: { name: 'Aura', logoUrl: null, logoDarkUrl: null }, isMobileRuntime: false }),
}));

import { SiteFooter } from './site-footer';

afterEach(cleanup);

const columns = [{ title: 'Shop', links: [{ label: 'Women', href: '/c/women' }] }];

describe('SiteFooter', () => {
  it('leads with a Get in touch strip, and social links as named icons', () => {
    render(
      <SiteFooter
        columns={columns}
        paymentNote="Pay online or on delivery"
        contact={{ email: 'hi@aura.ng', phone: '0801 234 5678', address: 'Lekki, Lagos' }}
        social={[{ platform: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/aura' }]}
        appHref="/app"
      />,
    );
    expect(screen.getByText('Get in touch')).toBeTruthy();
    expect(screen.getByText('Email us').closest('a')?.getAttribute('href')).toBe('mailto:hi@aura.ng');
    expect(screen.getByText('Call us').closest('a')?.getAttribute('href')).toBe('tel:08012345678');
    expect(screen.getByText('Visit us').closest('a')).toBeNull();
    expect(screen.getByRole('link', { name: 'Instagram (opens in a new tab)' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Get our app/ }).getAttribute('href')).toBe('/app');
    expect(screen.getByText('Pay online or on delivery')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Women' })).toBeTruthy();
  });

  it('leaves out the strip and the social row when the shop gave neither', () => {
    render(<SiteFooter columns={columns} />);
    expect(screen.queryByText('Get in touch')).toBeNull();
    expect(screen.queryByText('Follow us')).toBeNull();
    expect(screen.getByText(/© \d{4} Aura/)).toBeTruthy();
  });
});
