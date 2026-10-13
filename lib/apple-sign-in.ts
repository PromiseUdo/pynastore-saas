/*
 * lib/apple-sign-in.ts
 *
 * Sign in with Apple for staff (ROADMAP 19.2), on every surface. Apple
 * requires it beside Google in an iPhone app (App Review 4.8), and offering
 * it everywhere means an account made one way signs in anywhere.
 *
 * Apple's "client secret" isn't a fixed string: it is a token we sign with
 * the platform's Sign in with Apple key, valid for at most six months. So it
 * is made here when the server starts, from the key itself, instead of being
 * pasted in and silently expiring.
 *
 * Off until all four settings are present (.env.example): the button doesn't
 * show and the provider isn't registered.
 */
import { createPrivateKey, sign } from 'crypto';

/** Apple's ceiling is six months; a server restarts long before this. */
const SECRET_TTL_SECONDS = 150 * 24 * 60 * 60;

interface AppleSettings {
  /** the Services ID, e.g. com.mansaas.signin */
  clientId: string;
  teamId: string;
  keyId: string;
  /** the .p8 file's contents, with real or escaped (\n) line breaks */
  privateKey: string;
}

function settings(): AppleSettings | null {
  const clientId = process.env.AUTH_APPLE_ID?.trim();
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const keyId = process.env.APPLE_SIGN_IN_KEY_ID?.trim();
  const privateKey = process.env.APPLE_SIGN_IN_PRIVATE_KEY?.trim().replace(/\\n/g, '\n');
  if (!clientId || !teamId || !keyId || !privateKey) return null;
  return { clientId, teamId, keyId, privateKey };
}

export function appleSignInConfigured(): boolean {
  return settings() !== null;
}

const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

/** The ES256 client secret Apple expects (its "Creating a client secret" doc). */
export function appleClientSecret(now = Math.floor(Date.now() / 1000)): string | null {
  const s = settings();
  if (!s) return null;
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: s.keyId }));
  const payload = base64url(
    JSON.stringify({ iss: s.teamId, iat: now, exp: now + SECRET_TTL_SECONDS, aud: 'https://appleid.apple.com', sub: s.clientId }),
  );
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: createPrivateKey(s.privateKey),
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${payload}.${base64url(signature)}`;
}

export function appleClientId(): string | null {
  return settings()?.clientId ?? null;
}
