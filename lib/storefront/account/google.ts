/*
 * lib/storefront/account/google.ts
 *
 * "Continue with Google" for shoppers.
 *
 * THE PROBLEM THIS FILE SOLVES. Google only redirects to redirect URIs
 * registered in advance, exactly. This platform serves each store on
 * shop.{slug}.{ROOT_DOMAIN}, on the merchant's own custom domain, and on the
 * mobile origin — an open-ended set that grows every time a merchant signs
 * up. None of it can be registered ahead of time.
 *
 * So the OAuth round trip happens on ONE fixed origin, the root domain:
 *
 *   store /account/sign-in
 *      └─▶ {ROOT}/api/storefront/auth/google/start?slug=…&returnTo=…
 *            └─▶ Google
 *                  └─▶ {ROOT}/api/storefront/auth/google/callback   ← the one
 *                        └─▶ store origin /api/storefront/auth/handoff  registered
 *                              └─▶ sets the store's cookie, back to the page   URI
 *
 * One entry in the Google console covers every merchant, forever. The store's
 * session cookie is still only ever set on the store's own origin, by the
 * handoff step — the root domain never holds a shopper session.
 *
 * `state` is a signed token rather than an opaque id: it carries the slug and
 * the return URL through Google and comes back tamper-evident, and it is
 * bound to a nonce cookie set on the root domain so a state lifted from one
 * browser cannot be replayed in another.
 */
import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';
import { getMarketingUrl } from '@/lib/tenant/urls';
import { isLocalHostname } from '@/lib/tenant/resolveHostname';
import { accountSigningKey } from './session';

const STATE_AUDIENCE = 'mansaas:storefront-oauth-state';
const STATE_TTL_SECONDS = 10 * 60;
const ISSUER = 'mansaas';

export const GOOGLE_STATE_COOKIE = 'sf-oauth-state';

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export interface GoogleState {
  /** the store the shopper is signing in to */
  slug: string;
  /** absolute, already validated against that store (see ./return-url.ts) */
  returnTo: string;
  /** path inside the store to land on afterwards */
  next: string;
  /** matched against the nonce cookie on the way back */
  nonce: string;
}

export async function signState(state: GoogleState): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...state })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + STATE_TTL_SECONDS)
    .setIssuer(ISSUER)
    .setAudience(STATE_AUDIENCE)
    .sign(accountSigningKey());
}

export async function verifyState(token: string, nonce: string | undefined): Promise<GoogleState | null> {
  try {
    const { payload } = await jwtVerify(token, accountSigningKey(), {
      issuer: ISSUER,
      audience: STATE_AUDIENCE,
    });
    const state = payload as unknown as GoogleState;
    if (!state.slug || !state.returnTo || !state.nonce) return null;
    // The nonce ties this state to the browser that started the flow.
    if (!nonce || state.nonce !== nonce) return null;
    return { slug: state.slug, returnTo: state.returnTo, next: state.next || '/account', nonce: state.nonce };
  } catch {
    return null;
  }
}

/*
 * THE OAUTH ORIGIN — the single origin Google is allowed to redirect to, and
 * therefore the one that runs `start` and `callback`.
 *
 * In production that is the root domain, and nothing else needs saying.
 * Locally it can't be: Google refuses a plain-http redirect URI unless the
 * host is exactly `localhost` or `127.0.0.1` ("doesn't comply with Google's
 * OAuth 2.0 policy"), and this platform's dev root domain is
 * `app.localhost:3000` — a subdomain, which Google will not take.
 *
 * So the origin is its own setting. `STOREFRONT_OAUTH_ORIGIN` wins when set;
 * otherwise a non-production build whose root domain isn't already a bare
 * loopback host falls back to `http://localhost:{port}`, which is the one
 * shape Google accepts. Handing the session back to the store's own origin
 * afterwards is what this file already does for every tenant, so a dev origin
 * that differs from the root domain costs nothing — it is the same hop.
 */
export function oauthOrigin(): string {
  const configured = process.env.STOREFRONT_OAUTH_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, '');

  const rootOrigin = new URL(getMarketingUrl('/')).origin;
  if (process.env.NODE_ENV === 'production') return rootOrigin;

  const { hostname, port } = new URL(rootOrigin);
  if (hostname === 'localhost' || hostname === '127.0.0.1') return rootOrigin;
  if (!isLocalHostname(hostname)) return rootOrigin;

  return `http://localhost${port ? `:${port}` : ''}`;
}

/** Where Google sends the shopper back. Registered once, in the console. */
export function googleRedirectUri(): string {
  return `${oauthOrigin()}/api/storefront/auth/google/callback`;
}

export function googleAuthUrl(input: { redirectUri: string; state: string; loginHint?: string | null }): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', input.state);
  // A shopper may well hold accounts at several stores under different
  // addresses, so always let them choose rather than silently reusing
  // whichever Google session the browser happens to have.
  url.searchParams.set('prompt', 'select_account');
  if (input.loginHint) url.searchParams.set('login_hint', input.loginHint);
  return url.toString();
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/**
 * Swap the authorization code for an identity.
 *
 * The id_token's signature is verified against Google's published keys, with
 * this app's client id as the audience — the token is not simply decoded.
 * An unverified email is refused: linking by address (see
 * upsertShopperFromGoogle) is only safe because Google vouched for it.
 */
export async function exchangeGoogleCode(input: {
  code: string;
  redirectUri: string;
}): Promise<GoogleIdentity | null> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    console.error('[storefront-auth] Google token exchange failed:', response.status);
    return null;
  }

  const payload = (await response.json()) as { id_token?: string };
  if (!payload.id_token) return null;

  try {
    const { payload: claims } = await jwtVerify(payload.id_token, GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: process.env.GOOGLE_CLIENT_ID!,
    });

    const email = typeof claims.email === 'string' ? claims.email : null;
    const sub = typeof claims.sub === 'string' ? claims.sub : null;
    const emailVerified = claims.email_verified === true || claims.email_verified === 'true';

    if (!email || !sub || !emailVerified) return null;

    return {
      sub,
      email,
      name: typeof claims.name === 'string' ? claims.name : email.split('@')[0],
      emailVerified,
    };
  } catch (err) {
    console.error('[storefront-auth] Google id_token rejected:', err);
    return null;
  }
}
