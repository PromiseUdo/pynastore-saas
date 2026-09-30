/*
 * The shared rate limiter (ROADMAP 13.2) against the real database: the
 * rate_limit_take() SQL function every server instance counts through.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

process.env.RATE_LIMIT_STORE = 'database';

import { prisma } from '@/lib/prisma';
import { checkRateLimit, clearRateLimit, coolDown, requestLimitRetryAfter, takeRateLimits } from '@/lib/rate-limit';

vi.setConfig({ testTimeout: 60_000 });

const prefix = `__test-rl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const k = (name: string) => `${prefix}:${name}`;
const MINUTE = 60_000;

afterAll(async () => {
  await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: prefix } } });
  delete process.env.RATE_LIMIT_STORE;
});

const count = async (key: string) => (await prisma.rateLimitBucket.findUnique({ where: { key } }))?.count ?? 0;

describe('one bucket', () => {
  it('lets `limit` through in a window, then refuses', async () => {
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await checkRateLimit(k('one'), 3, MINUTE));
    expect(results).toEqual([true, true, true, false]);
    expect(await count(k('one'))).toBe(3);
  });

  it('starts again once the window has passed', async () => {
    await prisma.rateLimitBucket.update({ where: { key: k('one') }, data: { resetAt: new Date(Date.now() - 1000) } });
    expect(await checkRateLimit(k('one'), 3, MINUTE)).toBe(true);
    expect(await count(k('one'))).toBe(1);
  });

  it('never lets more than `limit` through, however many ask at once', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => checkRateLimit(k('race'), 5, MINUTE)));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(await count(k('race'))).toBe(5);
  });
});

describe('a chain of buckets', () => {
  it('stops at the first full one: earlier ones counted, later ones untouched', async () => {
    const chain = [
      { key: k('store'), limit: 10, windowMs: MINUTE },
      { key: k('member'), limit: 1, windowMs: MINUTE },
      { key: k('global'), limit: 10, windowMs: MINUTE },
    ];
    expect(await takeRateLimits(chain)).toEqual({ ok: true });
    const refused = await takeRateLimits(chain);
    expect(refused).toEqual({ ok: false, refused: chain[1] });
    expect([await count(k('store')), await count(k('member')), await count(k('global'))]).toEqual([2, 1, 1]);
  });

  it('tells a caller how long to wait: the full bucket’s window, at most 15 minutes', async () => {
    await checkRateLimit(k('hourly'), 1, 60 * MINUTE);
    expect(await requestLimitRetryAfter([{ key: k('hourly'), limit: 1, windowMs: 60 * MINUTE }])).toBe(15 * 60);
    expect(await requestLimitRetryAfter([{ key: k('fresh'), limit: 1, windowMs: MINUTE }])).toBeNull();
  });
});

describe('cool-downs', () => {
  const budget = [{ key: k('budget'), limit: 100, windowMs: MINUTE }];

  it('refuses everything they guard, without counting it, until cleared', async () => {
    await coolDown(k('pause'), MINUTE);
    expect(await takeRateLimits(budget, { blockedBy: k('pause') })).toEqual({ ok: false, refused: null });
    expect(await count(k('budget'))).toBe(0);
    await clearRateLimit(k('pause'));
    expect((await takeRateLimits(budget, { blockedBy: k('pause') })).ok).toBe(true);
  });

  it('never shortens a pause already running', async () => {
    await coolDown(k('long'), 10 * MINUTE);
    await coolDown(k('long'), 5_000);
    const row = await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key: k('long') } });
    expect(row.resetAt.getTime() - Date.now()).toBeGreaterThan(9 * MINUTE);
  });
});

describe('when the store can’t be reached', () => {
  it('lets a request through, but refuses a model budget', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('connection refused'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await checkRateLimit(k('down'), 1, MINUTE)).toBe(true);
      expect(await takeRateLimits([{ key: k('down'), limit: 1, windowMs: MINUTE }], { onError: 'deny' })).toEqual({ ok: false, refused: null });
    } finally {
      spy.mockRestore();
      quiet.mockRestore();
    }
  });
});
