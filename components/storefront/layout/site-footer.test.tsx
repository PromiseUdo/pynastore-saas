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
  it('lists the address, phone and email under the social links, each a link', () => {
    render(
      <SiteFooter
        columns={columns}
        paymentMethods={[
          { id: 'pod', label: 'Pay on delivery', description: '', handoffNote: '', provider: 'manual', settlesOnDelivery: true, enabled: true },
        ]}
        contact={{ email: 'hi@aura.ng', phone: '0801 234 5678', address: 'Lekki, Lagos' }}
        social={[{ platform: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/aura' }]}
        appHref="/app"
      />,
    );
    expect(screen.queryByText('Get in touch')).toBeNull();
    const heading = screen.getByText('Visit or contact us');
    // After "Follow us" in the same column.
    expect(screen.getByText('Follow us').compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const visit = screen.getByRole('link', { name: /Address: Lekki, Lagos/ });
    expect(visit.getAttribute('href')).toBe('https://www.google.com/maps/search/?api=1&query=Lekki%2C%20Lagos');
    expect(visit.getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: /Phone: 0801 234 5678/ }).getAttribute('href')).toBe('tel:08012345678');
    expect(screen.getByRole('link', { name: /Email: hi@aura.ng/ }).getAttribute('href')).toBe('mailto:hi@aura.ng');
    expect(screen.getByRole('link', { name: 'Instagram (opens in a new tab)' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Get our app/ }).getAttribute('href')).toBe('/app');
    expect(screen.getByRole('list', { name: 'Ways to pay' }).textContent).toContain('Pay on delivery');
    expect(screen.getByRole('link', { name: 'Women' })).toBeTruthy();
  });

  it('leaves out the contact list and the social row when the shop gave neither', () => {
    render(<SiteFooter columns={columns} />);
    expect(screen.queryByText('Visit or contact us')).toBeNull();
    expect(screen.queryByText('Follow us')).toBeNull();
    expect(screen.getByText(/© \d{4} Aura/)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Ways to pay' })).toBeNull();
  });
});
