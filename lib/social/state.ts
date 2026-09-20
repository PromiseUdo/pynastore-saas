/*
 * lib/social/state.ts
 *
 * The OAuth `state` parameter, and why it carries a tenant.
 *
 * MansaaS admin lives on {slug}.{ROOT_DOMAIN}, but Meta allows no wildcard
 * in its Valid OAuth Redirect URIs, so every merchant's callback lands on a
 * single fixed URL on the root domain. Route handlers under /api are also
 * excluded from proxy.ts's matcher, so that callback gets no `x-org-slug`
 * header. The organization therefore has to travel inside `state`.
 *
 * That makes `state` security-relevant, so it is:
 *   - signed with HMAC-SHA256 over AUTH_SECRET, so the organizationId cannot
 *     be edited in the address bar;
 *   - bound to the user who started the flow, so a signed state captured
 *     from someone else's browser is useless;
 *   - paired with an httpOnly nonce cookie (double-submit), so a state
 *     replayed from elsewhere fails;
 *   - short-lived.
 *
 * None of this is trusted on its own: the callback still re-loads the
 * membership for the organizationId in the state and re-checks the
 * permission before writing anything. The signature protects the handoff;
 * the membership check is what actually enforces the tenant boundary.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { safeEqual } from './crypto';
import { SocialProviderError, type SocialPlatform } from './types';

/** Ten minutes is generous for a login hop and short for a stolen link. */
const STATE_TTL_MS = 10 * 60 * 1000;

export const STATE_COOKIE = 'mansaas.social_oauth';

export interface SocialOAuthState {
  /** The tenant this flow belongs to. Re-verified in the callback. */
  organizationId: string;
  /** The member who started it; only they may finish it. */
  userId: string;
  /** Matched against the httpOnly cookie. */
  nonce: string;
  provider: SocialPlatform;
  /** Absolute URL on the merchant's own subdomain to return to. */
  returnTo: string;
  /** Epoch ms. */
  expiresAt: number;
}

function secret(): string {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value) throw new SocialProviderError('not_configured', 'AUTH_SECRET is not set');
  return value;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function createNonce(): string {
  return randomBytes(24).toString('base64url');
}

/** Signs a state value for the redirect. */
export function encodeState(state: Omit<SocialOAuthState, 'expiresAt'> & { expiresAt?: number }): string {
  const full: SocialOAuthState = { ...state, expiresAt: state.expiresAt ?? Date.now() + STATE_TTL_MS };
  const payload = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/**
 * Verifies and parses a state that came back from the platform.
 *
 * `cookieNonce` is the value of the httpOnly cookie on this request. A state
 * whose nonce doesn't match it is rejected even if the signature is good:
 * that is the CSRF half of the check.
 */
export function decodeState(raw: string | null | undefined, cookieNonce: string | null | undefined): SocialOAuthState {
  if (!raw) throw new SocialProviderError('invalid_state', 'Missing state');

  const separator = raw.lastIndexOf('.');
  if (separator < 1) throw new SocialProviderError('invalid_state', 'Malformed state');

  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);

  if (!safeEqual(signature, sign(payload))) {
    throw new SocialProviderError('invalid_state', 'State signature did not verify');
  }

  let state: SocialOAuthState;
  try {
    state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new SocialProviderError('invalid_state', 'State payload was not JSON');
  }

  if (!state.organizationId || !state.userId || !state.nonce || !state.returnTo) {
    throw new SocialProviderError('invalid_state', 'State is missing required fields');
  }
  if (!Number.isFinite(state.expiresAt) || state.expiresAt < Date.now()) {
    throw new SocialProviderError('invalid_state', 'State expired');
  }
  if (!cookieNonce || !safeEqual(state.nonce, cookieNonce)) {
    throw new SocialProviderError('invalid_state', 'State nonce did not match the cookie');
  }

  return state;
}

/**
 * Cookie options for the nonce. Scoped to the root domain because the flow
 * starts on {slug}.{ROOT_DOMAIN} and finishes on {ROOT_DOMAIN} — the same
 * reason auth.config.ts scopes the session cookie that way.
 *
 * `sameSite: 'lax'` is required: the callback arrives as a top-level
 * navigation from facebook.com, and 'strict' would withhold the cookie.
 */
export function stateCookieOptions(rootDomain: string, secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    domain: `.${rootDomain.split(':')[0]}`,
    path: '/',
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  };
}
