/*
 * lib/domains/pricing.ts
 *
 * Converts a Namecheap USD price into the NGN amount to charge/display,
 * using the admin-set rate from lib/settings.ts. The rate is snapshotted
 * into the return value so callers (checkout) can record exactly what was
 * used at charge time, independent of later rate changes.
 */
import { getUsdToNgnRate } from '@/lib/settings';

export type DomainQuote = {
  usdPrice: number;
  ngnPrice: number;
  exchangeRate: number;
};

export async function quoteDomainNgn(usdPrice: number): Promise<DomainQuote> {
  const exchangeRate = await getUsdToNgnRate();
  const ngnPrice = Math.round(usdPrice * exchangeRate);
  return { usdPrice, ngnPrice, exchangeRate };
}
