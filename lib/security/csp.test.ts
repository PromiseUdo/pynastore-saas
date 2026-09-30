import { afterEach, describe, expect, it } from 'vitest';
import { buildCsp, cspMode, makeNonce } from './csp';

const parse = (policy: string) =>
  Object.fromEntries(policy.split('; ').map((d) => { const [name, ...values] = d.split(' '); return [name, values]; }));

describe('the policy', () => {
  const base = { nonce: 'abc123', storefront: false, dev: false, https: true };

  it('runs only scripts carrying this request’s nonce, and nothing framed or plugged in', () => {
    const p = parse(buildCsp(base));
    expect(p['script-src']).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(p['object-src']).toEqual(["'none'"]);
    expect(p['frame-ancestors']).toEqual(["'none'"]);
    expect(p['base-uri']).toEqual(["'self'"]);
    expect(p['upgrade-insecure-requests']).toEqual([]);
    expect(p['report-uri']).toEqual(['/api/csp-report']);
  });

  it('allows merchant uploads to Cloudinary, and sign-in and payment redirects after a form', () => {
    const p = parse(buildCsp(base));
    expect(p['connect-src']).toContain('https://api.cloudinary.com');
    expect(p['img-src']).toContain('https://res.cloudinary.com');
    expect(p['form-action']).toEqual(expect.arrayContaining(["'self'", 'https://accounts.google.com', 'https://checkout.paystack.com']));
  });

  it('lets only the storefront reach the two measurement tags a merchant can switch on', () => {
    const admin = buildCsp(base);
    const shop = buildCsp({ ...base, storefront: true });
    for (const origin of ['googletagmanager.com', 'google-analytics.com', 'connect.facebook.net']) {
      expect(admin).not.toContain(origin);
      expect(shop).toContain(origin);
    }
  });

  it('allows eval and the dev socket only in development, and never upgrades plain http', () => {
    const dev = parse(buildCsp({ ...base, dev: true, https: false }));
    expect(dev['script-src']).toContain("'unsafe-eval'");
    expect(dev['connect-src']).toEqual(expect.arrayContaining(['ws:', 'wss:']));
    expect(dev['upgrade-insecure-requests']).toBeUndefined();
    expect(buildCsp(base)).not.toContain('unsafe-eval');
  });
});

describe('nonces and the switch', () => {
  afterEach(() => {
    delete process.env.CSP_MODE;
  });

  it('makes a different, long nonce every time', () => {
    const a = makeNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(makeNonce()).not.toBe(a);
  });

  it('enforces unless told to only report, or to stay off', () => {
    expect(cspMode()).toBe('enforce');
    process.env.CSP_MODE = 'report';
    expect(cspMode()).toBe('report');
    process.env.CSP_MODE = 'off';
    expect(cspMode()).toBe('off');
    process.env.CSP_MODE = 'nonsense';
    expect(cspMode()).toBe('enforce');
  });
});
