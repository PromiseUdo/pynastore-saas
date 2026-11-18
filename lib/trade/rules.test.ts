import { describe, expect, it } from 'vitest';
import { BusinessDetailsSchema, offersWholesaleEntry, openInTradeOnly, tradeMayPayWith, TRADE_STATUS_LABEL, WHOLESALE_MODES } from './rules';

describe('a Trade only shop', () => {
  it('keeps sign-in, the account, the merchant’s pages and the wholesale page open', () => {
    for (const path of ['/account', '/account/sign-in?next=%2F', '/account/trade', '/pages/terms', '/wholesale', '/invoice/abc', '/order-invoice/abc']) {
      expect(openInTradeOnly(path), path).toBe(true);
    }
  });

  it('closes everything that shows a product or a price', () => {
    for (const path of ['/', '/products', '/products/shoe', '/c/men', '/search?q=rice', '/cart', '/checkout', '/accountant', '/invoices', null]) {
      expect(openInTradeOnly(path), String(path)).toBe(false);
    }
  });
});

describe('how a trade buyer may pay', () => {
  const all = { tradePayOnline: true, tradePayTransfer: true, tradePayOnDelivery: true };
  it('follows the merchant’s choices, method by method', () => {
    expect(['paystack', 'transfer', 'pod'].every((id) => tradeMayPayWith(id, all))).toBe(true);
    expect(tradeMayPayWith('pod', { ...all, tradePayOnDelivery: false })).toBe(false);
    expect(tradeMayPayWith('paystack', { ...all, tradePayOnline: false })).toBe(false);
  });
  it('never lets an unknown method through', () => {
    expect(tradeMayPayWith('wallet', all)).toBe(false);
  });
});

describe('business details', () => {
  it('needs a business name; the rest is optional and blank means none', () => {
    expect(BusinessDetailsSchema.safeParse({ businessName: ' ' }).success).toBe(false);
    expect(BusinessDetailsSchema.parse({ businessName: ' Ada Provisions ', taxId: '', cacNumber: '  ' })).toEqual({
      businessName: 'Ada Provisions',
      taxId: null,
      cacNumber: null,
    });
  });
});

describe('words on screen', () => {
  it('has a label for every status and mode, in sentence case', () => {
    for (const label of [...Object.values(TRADE_STATUS_LABEL), ...WHOLESALE_MODES.map((m) => m.label)]) {
      expect(label.slice(1), label).toBe(label.slice(1).toLowerCase());
    }
  });
});

describe('offersWholesaleEntry', () => {
  it('shows "Buy wholesale" for a trade-only shop, and for one selling to both while it takes requests', () => {
    expect(offersWholesaleEntry({ mode: 'TRADE_ONLY', requestsOpen: false })).toBe(true);
    expect(offersWholesaleEntry({ mode: 'RETAIL_AND_TRADE', requestsOpen: true })).toBe(true);
  });

  it('shows nothing when requests are closed, or wholesale is off', () => {
    expect(offersWholesaleEntry({ mode: 'RETAIL_AND_TRADE', requestsOpen: false })).toBe(false);
    expect(offersWholesaleEntry({ mode: 'OFF', requestsOpen: true })).toBe(false);
  });
});
