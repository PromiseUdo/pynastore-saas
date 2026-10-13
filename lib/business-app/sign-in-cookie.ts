/*
 * lib/business-app/sign-in-cookie.ts
 *
 * What the business app's sign-in sheet remembers between "start" and
 * "finish" (ROADMAP 19.2): the app's challenge, and the page on the
 * business host to land on. Signed, httpOnly, ten minutes, and only ever
 * sent to /api/business/auth on the platform host. Server only.
 */
import { SignJWT, jwtVerify } from 'jose';
import { createHash } from 'crypto';
import { isValidChallenge } from './tickets';

export const SIGN_IN_COOKIE = 'mansaas-business-sign-in';
export const SIGN_IN_COOKIE_PATH = '/api/business/auth';
const TTL_SECONDS = 10 * 60;
const AUDIENCE = 'mansaas:business-sign-in';

function key(): Uint8Array {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) throw new Error('AUTH_SECRET is not set');
  return createHash('sha256').update(`${AUDIENCE}:${secret}`).digest();
}

export interface SignInState {
  challenge: string;
  next: string;
}

export async function sealSignInState(state: SignInState): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...state })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + TTL_SECONDS)
    .setAudience(AUDIENCE)
    .sign(key());
}

export async function openSignInState(token: string | undefined): Promise<SignInState | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { audience: AUDIENCE });
    if (!isValidChallenge(payload.challenge as string) || typeof payload.next !== 'string') return null;
    return { challenge: payload.challenge as string, next: payload.next };
  } catch {
    return null;
  }
}

export const signInCookieOptions = (secure: boolean) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure,
  path: SIGN_IN_COOKIE_PATH,
  maxAge: TTL_SECONDS,
});
