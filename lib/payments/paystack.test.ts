import { afterEach, describe, expect, it } from 'vitest';
import { isPaystackConfigured, isPaystackTestMode, paystackConfigProblem, verifyPaystackSignature } from './paystack';
import { createHmac } from 'crypto';

const was = { key: process.env.PAYSTACK_SECRET_KEY, mode: process.env.PAYSTACK_MODE };
afterEach(() => {
  for (const [name, value] of [['PAYSTACK_SECRET_KEY', was.key], ['PAYSTACK_MODE', was.mode]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function set(key: string | undefined, mode: string | undefined) {
  if (key === undefined) delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY = key;
  if (mode === undefined) delete process.env.PAYSTACK_MODE;
  else process.env.PAYSTACK_MODE = mode;
}

describe('Paystack configuration (ROADMAP 10.11)', () => {
  it('follows the key when no mode is declared', () => {
    set('sk_test_abc', undefined);
    expect(paystackConfigProblem()).toBeNull();
    expect(isPaystackTestMode()).toBe(true);
    set('sk_live_abc', undefined);
    expect(paystackConfigProblem()).toBeNull();
    expect(isPaystackTestMode()).toBe(false);
  });

  it('refuses to talk to Paystack when the key doesn’t match the declared mode', () => {
    set('sk_test_abc', 'live');
    expect(paystackConfigProblem()).toMatch(/"live" but .* test key/);
    expect(isPaystackConfigured()).toBe(false);
    set('sk_live_abc', 'test');
    expect(isPaystackConfigured()).toBe(false);
    set('sk_live_abc', 'live');
    expect(isPaystackConfigured()).toBe(true);
    set('sk_live_abc', 'production');
    expect(paystackConfigProblem()).toMatch(/must be "live" or "test"/);
  });

  it('accepts no webhook while misconfigured, even one signed with the key', () => {
    const body = '{"event":"charge.success"}';
    const signature = createHmac('sha512', 'sk_test_abc').update(body).digest('hex');
    set('sk_test_abc', undefined);
    expect(verifyPaystackSignature(body, signature)).toBe(true);
    set('sk_test_abc', 'live');
    expect(verifyPaystackSignature(body, signature)).toBe(false);
  });

  it('says so when there is no key at all', () => {
    set(undefined, undefined);
    expect(paystackConfigProblem()).toMatch(/not configured/);
    expect(isPaystackConfigured()).toBe(false);
  });
});
