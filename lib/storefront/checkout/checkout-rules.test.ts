import { describe, expect, it } from 'vitest';
import { shopperCanPay } from './checkout-rules';

describe('shopperCanPay', () => {
  it('is true while any one way to pay is on', () => {
    expect(shopperCanPay({ payOnDelivery: true, onlineReady: false, activeBankAccounts: 0 })).toBe(true);
    expect(shopperCanPay({ payOnDelivery: false, onlineReady: true, activeBankAccounts: 0 })).toBe(true);
    expect(shopperCanPay({ payOnDelivery: false, onlineReady: false, activeBankAccounts: 1 })).toBe(true);
  });

  it('is false only when every way is off', () => {
    expect(shopperCanPay({ payOnDelivery: false, onlineReady: false, activeBankAccounts: 0 })).toBe(false);
  });
});
