/*
 * The go-live script that moves the social-token key off AUTH_SECRET must
 * print EXACTLY the key lib/social/crypto.ts derives today — otherwise
 * setting SOCIAL_TOKEN_KEY to its output would disconnect every merchant.
 */
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { open, resetSocialKeyCache, seal } from './crypto';

const envWas = { auth: process.env.AUTH_SECRET, key: process.env.SOCIAL_TOKEN_KEY };
afterEach(() => {
  process.env.AUTH_SECRET = envWas.auth;
  if (envWas.key === undefined) delete process.env.SOCIAL_TOKEN_KEY;
  else process.env.SOCIAL_TOKEN_KEY = envWas.key;
  resetSocialKeyCache();
});

describe('scripts/derive-social-token-key.mjs', () => {
  it('prints the key tokens are sealed with today, so switching to it keeps them readable', () => {
    process.env.AUTH_SECRET = 'a-production-like-auth-secret-0123456789';
    delete process.env.SOCIAL_TOKEN_KEY;
    resetSocialKeyCache();
    const sealedToday = seal('EAAB-page-token');

    const printed = execFileSync('node', ['scripts/derive-social-token-key.mjs'], {
      env: { ...process.env, SOCIAL_TOKEN_KEY: undefined },
      encoding: 'utf8',
    }).trim();
    expect(Buffer.from(printed, 'base64')).toHaveLength(32);

    process.env.SOCIAL_TOKEN_KEY = printed;
    process.env.AUTH_SECRET = 'rotated-to-something-else-entirely-9876543210';
    resetSocialKeyCache();
    expect(open(sealedToday)).toBe('EAAB-page-token');
  });
});
