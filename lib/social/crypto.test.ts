/*
 * Token encryption.
 *
 * Access tokens are the one thing in the social system that would let
 * someone post as a merchant, so the properties tested here are the ones
 * that keep a leaked database row worthless: it decrypts only with the key,
 * it fails loudly rather than quietly when altered, and two seals of the
 * same token don't look alike.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { seal, open, sealJson, openJson, safeEqual, resetSocialKeyCache, SocialCryptoError } from './crypto';

const KEY_A = Buffer.alloc(32, 1).toString('base64');
const KEY_B = Buffer.alloc(32, 2).toString('base64');

/**
 * Alters exactly one BYTE of a base64url segment.
 *
 * Editing the base64 text directly is not good enough: the final character of
 * a base64 string can carry bits the decoder discards, so changing it may
 * decode to the very same bytes and tamper with nothing. Decoding, flipping a
 * bit and re-encoding guarantees the ciphertext really did change — which is
 * what these tests are trying to assert.
 */
function flipAByte(segment: string): string {
  const bytes = Buffer.from(segment, 'base64url');
  bytes[0] ^= 0xff;
  return bytes.toString('base64url');
}

beforeEach(() => {
  process.env.SOCIAL_TOKEN_KEY = KEY_A;
  resetSocialKeyCache();
});

describe('seal / open', () => {
  it('round-trips a token', () => {
    const token = 'EAAG1ZClongLivedPageToken_0123456789';
    expect(open(seal(token))).toBe(token);
  });

  it('round-trips unicode and empty strings', () => {
    expect(open(seal(''))).toBe('');
    expect(open(seal('Adé’s Store — ₦1,200'))).toBe('Adé’s Store — ₦1,200');
  });

  it('never repeats a ciphertext, so equal tokens are not linkable', () => {
    const token = 'same-token';
    expect(seal(token)).not.toBe(seal(token));
  });

  it('does not leak the plaintext into the stored value', () => {
    const sealed = seal('EAAG1ZCsecret');
    expect(sealed).not.toContain('EAAG1ZCsecret');
    expect(sealed.startsWith('v1.')).toBe(true);
  });

  it('refuses a ciphertext whose bytes were altered', () => {
    const parts = seal('EAAG1ZCsecret').split('.');
    parts[3] = flipAByte(parts[3]);
    expect(() => open(parts.join('.'))).toThrow(SocialCryptoError);
  });

  it('refuses a ciphertext whose auth tag was altered', () => {
    const parts = seal('EAAG1ZCsecret').split('.');
    parts[2] = flipAByte(parts[2]);
    expect(() => open(parts.join('.'))).toThrow(SocialCryptoError);
  });

  it('refuses a ciphertext whose IV was altered', () => {
    const parts = seal('EAAG1ZCsecret').split('.');
    parts[1] = flipAByte(parts[1]);
    expect(() => open(parts.join('.'))).toThrow(SocialCryptoError);
  });

  it('refuses a value sealed under a different key', () => {
    const sealed = seal('EAAG1ZCsecret');
    process.env.SOCIAL_TOKEN_KEY = KEY_B;
    resetSocialKeyCache();
    expect(() => open(sealed)).toThrow(SocialCryptoError);
  });

  it('refuses a malformed or unversioned value', () => {
    expect(() => open('not-a-ciphertext')).toThrow(SocialCryptoError);
    expect(() => open('v9.a.b.c')).toThrow(SocialCryptoError);
    expect(() => open('')).toThrow(SocialCryptoError);
  });

  it('rejects a key that is not 32 bytes', () => {
    process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(16, 3).toString('base64');
    resetSocialKeyCache();
    expect(() => seal('x')).toThrow(SocialCryptoError);
  });

  it('falls back to AUTH_SECRET when no dedicated key is set', () => {
    delete process.env.SOCIAL_TOKEN_KEY;
    process.env.AUTH_SECRET = 'development-secret';
    resetSocialKeyCache();
    expect(open(seal('works-in-dev'))).toBe('works-in-dev');
  });
});

describe('sealJson / openJson', () => {
  it('round-trips the draft payload shape', () => {
    const payload = {
      accounts: [{ platformAccountId: '123', accessToken: 'EAAG1ZC', scopes: ['pages_show_list'] }],
      grantedScopes: ['pages_show_list'],
    };
    expect(openJson(sealJson(payload))).toEqual(payload);
  });
});

describe('safeEqual', () => {
  it('compares equal and unequal values without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});
