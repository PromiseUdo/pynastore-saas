import { afterEach, describe, expect, it } from 'vitest';
import { getMobileApp, resolveMobileRoute } from '@/lib/mobile/app-config';

const ENV_KEYS = ['NEXT_PUBLIC_MOBILE_APP_MODE', 'NEXT_PUBLIC_MOBILE_APP_SLUG'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('getMobileApp', () => {
  it('defaults to mall mode with no env set', () => {
    delete process.env.NEXT_PUBLIC_MOBILE_APP_MODE;
    delete process.env.NEXT_PUBLIC_MOBILE_APP_SLUG;
    expect(getMobileApp()).toEqual({ mode: 'mall', lockedSlug: null });
  });

  it('stays in mall mode if branded is requested without a slug', () => {
    process.env.NEXT_PUBLIC_MOBILE_APP_MODE = 'branded';
    delete process.env.NEXT_PUBLIC_MOBILE_APP_SLUG;
    expect(getMobileApp()).toEqual({ mode: 'mall', lockedSlug: null });
  });

  it('enters branded mode with a normalized slug', () => {
    process.env.NEXT_PUBLIC_MOBILE_APP_MODE = 'branded';
    process.env.NEXT_PUBLIC_MOBILE_APP_SLUG = ' Acme_Shop! ';
    expect(getMobileApp()).toEqual({ mode: 'branded', lockedSlug: 'acmeshop' });
  });
});

describe('resolveMobileRoute — mall mode', () => {
  const app = { mode: 'mall', lockedSlug: null } as const;

  it('routes the root to the picker', () => {
    expect(resolveMobileRoute('/', app)).toEqual({ kind: 'picker' });
  });

  it('passes picker routes through', () => {
    expect(resolveMobileRoute('/m', app)).toEqual({ kind: 'mpath' });
    expect(resolveMobileRoute('/m/search', app)).toEqual({ kind: 'mpath' });
  });

  it('routes /s/{slug} to that storefront', () => {
    expect(resolveMobileRoute('/s/acme', app)).toEqual({ kind: 'storefront', slug: 'acme', rest: '' });
    expect(resolveMobileRoute('/s/acme/products/x', app)).toEqual({
      kind: 'storefront',
      slug: 'acme',
      rest: '/products/x',
    });
  });

  it('sends anything else home (admin block)', () => {
    expect(resolveMobileRoute('/dashboard', app)).toEqual({ kind: 'home' });
    expect(resolveMobileRoute('/login', app)).toEqual({ kind: 'home' });
  });
});

describe('resolveMobileRoute — branded mode', () => {
  const app = { mode: 'branded', lockedSlug: 'acme' } as const;

  it('opens the root straight into the locked store', () => {
    expect(resolveMobileRoute('/', app)).toEqual({ kind: 'storefront', slug: 'acme', rest: '' });
  });

  it('serves deep paths for the locked store', () => {
    expect(resolveMobileRoute('/s/acme/cart', app)).toEqual({
      kind: 'storefront',
      slug: 'acme',
      rest: '/cart',
    });
  });

  it('bounces links to any other store home', () => {
    expect(resolveMobileRoute('/s/other', app)).toEqual({ kind: 'home' });
  });

  it('has no picker', () => {
    expect(resolveMobileRoute('/m', app)).toEqual({ kind: 'home' });
    expect(resolveMobileRoute('/dashboard', app)).toEqual({ kind: 'home' });
  });
});
