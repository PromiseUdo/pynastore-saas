import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDemoShopUrl } from './demo';

describe('getDemoShopUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is null when unset or blank', () => {
    vi.stubEnv('DEMO_SHOP_URL', '');
    expect(getDemoShopUrl()).toBeNull();
    vi.stubEnv('DEMO_SHOP_URL', '   ');
    expect(getDemoShopUrl()).toBeNull();
  });

  it('accepts an https address', () => {
    vi.stubEnv('DEMO_SHOP_URL', ' https://shop-demo.pynastore.com ');
    expect(getDemoShopUrl()).toBe('https://shop-demo.pynastore.com/');
  });

  it('refuses anything that is not https', () => {
    for (const bad of ['http://shop-demo.pynastore.com', 'javascript:alert(1)', 'shop-demo.pynastore.com', 'not a url']) {
      vi.stubEnv('DEMO_SHOP_URL', bad);
      expect(getDemoShopUrl()).toBeNull();
    }
  });
});
