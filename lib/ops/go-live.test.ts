import { describe, expect, it } from 'vitest';
import { goLiveChecks, type GoLiveFacts } from './go-live';

const LIVE_ENV = {
  PAYSTACK_SECRET_KEY: 'sk_live_abc',
  PAYSTACK_MODE: 'live',
  RESEND_API_KEY: 're_live',
  EMAIL_FROM: 'Notely <hello@getnotely.io>',
  SOCIAL_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64'),
  META_APP_ID: '123',
  META_APP_SECRET: 'shh',
  META_REDIRECT_URI: 'https://app.getnotely.io/api/social/meta/callback',
  AUTH_SECRET: 'x'.repeat(44),
  DIRECT_URL: 'postgresql://direct',
  CRON_SECRET: 'cron-value-7f3a',
  PLATFORM_ADMIN_EMAIL: 'staff@example.com',
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: 'c',
  NEXT_PUBLIC_CLOUDINARY_API_KEY: 'k',
  CLOUDINARY_API_SECRET: 's',
};
const FACTS: GoLiveFacts = {
  lastWebhook: { at: '2026-10-01T09:00:00Z', mode: 'live' },
  payoutsToMove: 0,
  expectedMetaRedirect: 'https://app.getnotely.io/api/social/meta/callback',
  now: new Date('2026-10-01T10:00:00Z'),
};
const statusOf = (env: Record<string, string | undefined>, facts: Partial<GoLiveFacts> = {}) =>
  Object.fromEntries(goLiveChecks(env, { ...FACTS, ...facts }).map((c) => [c.id, c.status]));

describe('the go-live checklist', () => {
  it('is all green for a server set up for live', () => {
    expect(Object.values(statusOf(LIVE_ENV)).every((s) => s === 'ok')).toBe(true);
  });

  it('flags a test key, a mode mismatch, and a webhook only seen in test mode', () => {
    expect(statusOf({ ...LIVE_ENV, PAYSTACK_SECRET_KEY: 'sk_test_x' })['paystack-key']).toBe('action');
    expect(statusOf({ ...LIVE_ENV, PAYSTACK_MODE: undefined })['paystack-key']).toBe('action');
    expect(statusOf(LIVE_ENV, { lastWebhook: { at: FACTS.now.toISOString(), mode: 'test' } })['paystack-webhook']).toBe('action');
    expect(statusOf(LIVE_ENV, { lastWebhook: null })['paystack-webhook']).toBe('action');
  });

  it('flags payout accounts still to move, and the sending address', () => {
    expect(statusOf(LIVE_ENV, { payoutsToMove: 3 }).payouts).toBe('action');
    expect(statusOf({ ...LIVE_ENV, EMAIL_FROM: 'Acme <onboarding@resend.dev>' }).email).toBe('action');
  });

  it('flags a missing or malformed social key, and never repeats a secret', () => {
    expect(statusOf({ ...LIVE_ENV, SOCIAL_TOKEN_KEY: undefined })['social-key']).toBe('action');
    expect(statusOf({ ...LIVE_ENV, SOCIAL_TOKEN_KEY: 'short' })['social-key']).toBe('action');
    const text = JSON.stringify(goLiveChecks(LIVE_ENV, FACTS));
    for (const secret of ['sk_live_abc', 're_live', 'shh', LIVE_ENV.SOCIAL_TOKEN_KEY, LIVE_ENV.AUTH_SECRET, 'cron-value-7f3a']) {
      expect(text).not.toContain(secret);
    }
  });
});
