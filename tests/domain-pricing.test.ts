import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getUsdToNgnRate, setUsdToNgnRate } from '@/lib/settings';
import { quoteDomainNgn } from '@/lib/domains/pricing';

describe('lib/settings — usd_to_ngn_rate', () => {
  let originalRate: number;

  beforeAll(async () => {
    originalRate = await getUsdToNgnRate();
  });

  afterAll(async () => {
    await setUsdToNgnRate(originalRate);
  });

  it('round-trips a rate set via setUsdToNgnRate', async () => {
    await setUsdToNgnRate(1234.5);
    await expect(getUsdToNgnRate()).resolves.toBe(1234.5);
  });

  it('overwrites a previously set rate rather than creating a duplicate row', async () => {
    await setUsdToNgnRate(1500);
    await setUsdToNgnRate(1700);
    await expect(getUsdToNgnRate()).resolves.toBe(1700);

    const rows = await prisma.platformSetting.findMany({ where: { key: 'usd_to_ngn_rate' } });
    expect(rows).toHaveLength(1);
  });

  it('rejects a non-positive rate', async () => {
    await expect(setUsdToNgnRate(0)).rejects.toThrow();
    await expect(setUsdToNgnRate(-5)).rejects.toThrow();
  });
});

describe('lib/domains/pricing — quoteDomainNgn', () => {
  let originalRate: number;

  beforeAll(async () => {
    originalRate = await getUsdToNgnRate();
  });

  afterAll(async () => {
    await setUsdToNgnRate(originalRate);
  });

  it('converts a USD price using the current admin-set rate', async () => {
    await setUsdToNgnRate(1600);
    const quote = await quoteDomainNgn(13.98);
    expect(quote).toEqual({ usdPrice: 13.98, ngnPrice: Math.round(13.98 * 1600), exchangeRate: 1600 });
  });

  it('reflects a rate change immediately (no stale caching)', async () => {
    await setUsdToNgnRate(1000);
    await expect(quoteDomainNgn(10)).resolves.toEqual({ usdPrice: 10, ngnPrice: 10000, exchangeRate: 1000 });

    await setUsdToNgnRate(2000);
    await expect(quoteDomainNgn(10)).resolves.toEqual({ usdPrice: 10, ngnPrice: 20000, exchangeRate: 2000 });
  });

  it('rounds the NGN amount to the nearest naira', async () => {
    await setUsdToNgnRate(1601.5);
    const quote = await quoteDomainNgn(1);
    expect(quote.ngnPrice).toBe(Math.round(1601.5));
    expect(Number.isInteger(quote.ngnPrice)).toBe(true);
  });
});
