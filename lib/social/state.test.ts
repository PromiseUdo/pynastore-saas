/*
 * The OAuth state.
 *
 * The state is what carries the tenant across Meta's redirect, because the
 * callback lands on the root domain with no `x-org-slug` header. If a
 * merchant could edit the organizationId in it, they could attach their own
 * Facebook Page to somebody else's store — so these tests are about the
 * state refusing to be edited, replayed or outlived.
 *
 * The callback still re-checks the membership behind the id it accepts
 * (app/api/social/meta/callback/route.ts); this is the first of the two
 * gates, not the only one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { encodeState, decodeState, createNonce } from './state';
import { SocialProviderError } from './types';

const NONCE = 'test-nonce-value';

const BASE = {
  organizationId: 'org_acme',
  userId: 'user_ada',
  nonce: NONCE,
  provider: 'FACEBOOK_PAGE' as const,
  returnTo: 'https://acme.app.example.com/social',
};

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-auth-secret';
});

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof SocialProviderError ? error.kind : 'other';
  }
  return 'no-throw';
}

describe('encodeState / decodeState', () => {
  it('round-trips the tenant, the user and the return URL', () => {
    const decoded = decodeState(encodeState(BASE), NONCE);
    expect(decoded.organizationId).toBe('org_acme');
    expect(decoded.userId).toBe('user_ada');
    expect(decoded.returnTo).toBe(BASE.returnTo);
    expect(decoded.provider).toBe('FACEBOOK_PAGE');
  });

  it('rejects a state whose organizationId was swapped for another store', () => {
    const state = encodeState(BASE);
    const [payload, signature] = [state.slice(0, state.lastIndexOf('.')), state.slice(state.lastIndexOf('.') + 1)];

    const tampered = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    tampered.organizationId = 'org_victim';
    const forged = `${Buffer.from(JSON.stringify(tampered), 'utf8').toString('base64url')}.${signature}`;

    expect(reason(() => decodeState(forged, NONCE))).toBe('invalid_state');
  });

  it('rejects a state signed with a different secret', () => {
    const state = encodeState(BASE);
    process.env.AUTH_SECRET = 'a-different-secret';
    expect(reason(() => decodeState(state, NONCE))).toBe('invalid_state');
  });

  it('rejects a valid state replayed without the matching cookie', () => {
    const state = encodeState(BASE);
    expect(reason(() => decodeState(state, null))).toBe('invalid_state');
    expect(reason(() => decodeState(state, 'some-other-nonce'))).toBe('invalid_state');
  });

  it('rejects an expired state', () => {
    const state = encodeState({ ...BASE, expiresAt: Date.now() - 1000 });
    expect(reason(() => decodeState(state, NONCE))).toBe('invalid_state');
  });

  it('rejects a missing or malformed state', () => {
    expect(reason(() => decodeState(null, NONCE))).toBe('invalid_state');
    expect(reason(() => decodeState('no-dot-separator', NONCE))).toBe('invalid_state');
    expect(reason(() => decodeState('....', NONCE))).toBe('invalid_state');
  });

  it('rejects a well-signed state that is missing required fields', () => {
    const state = encodeState({ ...BASE, organizationId: '' });
    expect(reason(() => decodeState(state, NONCE))).toBe('invalid_state');
  });
});

describe('createNonce', () => {
  it('is long and unpredictable', () => {
    const a = createNonce();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(createNonce());
  });
});
