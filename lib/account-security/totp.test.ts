/*
 * Authenticator codes (ROADMAP 14.5) against RFC 6238's own test vectors, so
 * the codes match what Google Authenticator and the rest show.
 */
import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, matchTotp, otpauthUri, stepAt, totpCode } from './totp';

// RFC 6238's SHA-1 secret: the ASCII "12345678901234567890".
const SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('matches RFC 6238 (the last six digits of its 8-digit values)', () => {
    expect(SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpCode(SECRET, stepAt(new Date(59_000)))).toBe('287082');
    expect(totpCode(SECRET, stepAt(new Date(1_111_111_109_000)))).toBe('081804');
    expect(totpCode(SECRET, stepAt(new Date(1_234_567_890_000)))).toBe('005924');
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from('any bytes at all ÿ');
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it('accepts the step either side for a phone’s clock, and no further', () => {
    const now = new Date(1_111_111_109_000);
    const step = stepAt(now);
    expect(matchTotp(SECRET, totpCode(SECRET, step), now)).toBe(step);
    expect(matchTotp(SECRET, totpCode(SECRET, step - 1), now)).toBe(step - 1);
    expect(matchTotp(SECRET, totpCode(SECRET, step + 1), now)).toBe(step + 1);
    expect(matchTotp(SECRET, totpCode(SECRET, step - 3), now)).toBeNull();
    expect(matchTotp(SECRET, 'abcdef', now)).toBeNull();
  });

  it('gives authenticator apps what they scan', () => {
    expect(otpauthUri({ issuer: 'Notely', account: 'ada@example.com', secret: SECRET })).toBe(
      'otpauth://totp/Notely%3Aada%40example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Notely&algorithm=SHA1&digits=6&period=30',
    );
  });
});
