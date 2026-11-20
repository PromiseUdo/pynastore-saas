// @vitest-environment jsdom
/*
 * The "Paid" stamp across a receipt: there only when the caller's record
 * says the money arrived, and never instead of the words.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('./print-button', () => ({ PrintButton: () => null }));

const { ReceiptDocument } = await import('./receipt-document');

afterEach(cleanup);

const props = {
  businessName: 'AurafumeNG',
  businessAddress: null,
  businessPhone: null,
  title: 'Receipt',
  facts: [{ label: 'Receipt', value: 'ORD-2026-000001' }],
  lines: [{ name: 'Kahmrar 50ml', variantName: null, quantity: 1, unitPrice: '₦10,000', total: '₦10,000' }],
  totals: [{ label: 'Subtotal', value: '₦10,000' }],
  total: { label: 'Total', value: '₦10,000' },
  footerFacts: [{ label: 'Status', value: 'Paid 20 Nov 2026' }],
};

describe('ReceiptDocument stamp', () => {
  it('stamps a paid document, for the eye only — the status line still says it', () => {
    const { container } = render(<ReceiptDocument {...props} stamp="Paid" />);
    const stamp = container.querySelector('[aria-hidden] span');
    expect(stamp?.textContent).toBe('Paid');
    expect(stamp?.className).toContain('rotate');
    expect(screen.getByText('Paid 20 Nov 2026')).toBeTruthy();
  });

  it('has no stamp when none is given', () => {
    render(<ReceiptDocument {...props} footerFacts={[{ label: 'Status', value: 'Not paid yet' }]} />);
    expect(screen.queryByText('Paid')).toBeNull();
  });
});
