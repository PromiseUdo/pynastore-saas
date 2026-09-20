/*
 * The OAuth origin — the one host Google is allowed to redirect to.
 *
 * Worth its own test because getting it wrong is invisible until a real
 * shopper presses the button: too loose and the callback lands somewhere
 * that can't read its own nonce cookie, too clever and local development
 * hits Google's "doesn't comply with OAuth 2.0 policy" wall, which is what
 * `app.localhost:3000` does.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { oauthOrigin, googleRedirectUri } from './google';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('oauthOrigin', () => {
  it('uses STOREFRONT_OAUTH_ORIGIN when set, without a trailing slash', () => {
    vi.stubEnv('STOREFRONT_OAUTH_ORIGIN', 'https://auth.example.com/');
    expect(oauthOrigin()).toBe('https://auth.example.com');
  });

  it('is the root domain in production', () => {
    vi.stubEnv('STOREFRONT_OAUTH_ORIGIN', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'mansaas.com');
    expect(oauthOrigin()).toBe('https://mansaas.com');
    expect(googleRedirectUri()).toBe('https://mansaas.com/api/storefront/auth/google/callback');
  });

  it('falls back to bare localhost in development, since Google refuses a localhost SUBdomain', () => {
    vi.stubEnv('STOREFRONT_OAUTH_ORIGIN', '');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'app.localhost:3000');
    expect(oauthOrigin()).toBe('http://localhost:3000');
  });

  it('leaves a root domain that is already bare localhost alone', () => {
    vi.stubEnv('STOREFRONT_OAUTH_ORIGIN', '');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'localhost:3000');
    expect(oauthOrigin()).toBe('http://localhost:3000');
  });

  it('never rewrites a real domain, whatever the build is called', () => {
    vi.stubEnv('STOREFRONT_OAUTH_ORIGIN', '');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'staging.mansaas.com');
    expect(oauthOrigin()).toBe('https://staging.mansaas.com');
  });
});
