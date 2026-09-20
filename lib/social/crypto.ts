/*
 * lib/social/crypto.ts
 *
 * Encryption for everything MansaaS holds on a merchant's behalf: Meta access
 * tokens and the short-lived candidate lists that carry them between the
 * OAuth callback and the account chooser.
 *
 * AES-256-GCM, so a tampered ciphertext fails to open rather than decrypting
 * to something else. Each seal carries its own random IV and the GCM tag, and
 * the whole thing is stored as one base64url string:
 *
 *     v1.<iv>.<tag>.<ciphertext>
 *
 * The version prefix is there so a future key rotation can read old rows.
 *
 * SERVER ONLY. Nothing here may be imported from a client component — the
 * import of `node:crypto` makes that a build error, which is the point.
 *
 * The key comes from SOCIAL_TOKEN_KEY (32 bytes, base64). When it isn't set
 * the key is derived from AUTH_SECRET with scrypt, so development and tests
 * work without extra setup; production must set SOCIAL_TOKEN_KEY, because
 * rotating AUTH_SECRET would otherwise silently make every stored token
 * unreadable.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12; // 96 bits — the size GCM is specified for
const KEY_BYTES = 32;

/** Fixed, non-secret salt: the secret is AUTH_SECRET, the salt only separates uses. */
const DERIVATION_SALT = 'mansaas.social.token.v1';

export class SocialCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SocialCryptoError';
  }
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const configured = process.env.SOCIAL_TOKEN_KEY?.trim();
  if (configured) {
    const key = Buffer.from(configured, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new SocialCryptoError(
        `SOCIAL_TOKEN_KEY must be ${KEY_BYTES} bytes of base64 (got ${key.length})`,
      );
    }
    cachedKey = key;
    return key;
  }

  const fallback = process.env.AUTH_SECRET?.trim();
  if (!fallback) {
    throw new SocialCryptoError('Set SOCIAL_TOKEN_KEY (or AUTH_SECRET) before storing social tokens');
  }
  cachedKey = scryptSync(fallback, DERIVATION_SALT, KEY_BYTES);
  return cachedKey;
}

/** Test seam: forget the derived key after changing the environment. */
export function resetSocialKeyCache(): void {
  cachedKey = null;
}

/** True when a key is available, so a caller can fail early with a clear message. */
export function socialCryptoConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypts a UTF-8 string. The result is safe to store in a text column. */
export function seal(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

/** Decrypts a value produced by `seal`. Throws if it was tampered with. */
export function open(sealed: string): string {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SocialCryptoError('Unrecognised ciphertext');
  }
  const [, ivPart, tagPart, dataPart] = parts;

  try {
    const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // Never surface node's own message: it differs between a bad tag and a
    // bad key, which is more than a caller needs to know.
    throw new SocialCryptoError('Could not decrypt — the key changed or the value was tampered with');
  }
}

/** Encrypts a JSON-serialisable value. */
export function sealJson(value: unknown): string {
  return seal(JSON.stringify(value));
}

/** Decrypts and parses a value written by `sealJson`. */
export function openJson<T>(sealed: string): T {
  return JSON.parse(open(sealed)) as T;
}

/** Constant-time string comparison, for nonces and signatures. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
