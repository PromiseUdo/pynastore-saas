/*
 * lib/domains/pricing.ts
 *
 * What a domain costs a merchant, in naira.
 *   - .com: Namecheap's USD price converted at the admin-set rate from
 *     lib/settings.ts. The rate is snapshotted into the quote so checkout
 *     records exactly what was used, whatever the rate does later.
 *   - .com.ng (ROADMAP 22.3): naira prices set in the console, since staff
 *     register it at QServers, not Namecheap. No dollar price, no rate.
 */
import { getComNgPricing, getUsdToNgnRate } from '@/lib/settings';
import { getTldPriceUsd } from './namecheap';
import { endingOf } from './rules';

export type DomainQuote = {
  usdPrice: number | null;
  ngnPrice: number;
  exchangeRate: number | null;
};

export async function quoteDomainNgn(usdPrice: number): Promise<DomainQuote & { usdPrice: number; exchangeRate: number }> {
  const exchangeRate = await getUsdToNgnRate();
  const ngnPrice = Math.round(usdPrice * exchangeRate);
  return { usdPrice, ngnPrice, exchangeRate };
}

/** A year of `domain`, registering or renewing. Throws when it can't be priced right now. */
export async function quoteDomain(domain: string, category: 'register' | 'renew'): Promise<DomainQuote> {
  if (endingOf(domain) === 'com.ng') {
    const p = await getComNgPricing();
    const ngn = category === 'register' ? p.registerPrice : p.renewPrice;
    if (ngn === null) throw new Error('.com.ng prices aren’t set in Billing settings.');
    return { usdPrice: null, ngnPrice: ngn, exchangeRate: null };
  }
  return quoteDomainNgn(await getTldPriceUsd(domain.split('.').slice(1).join('.'), category));
}

/** A renewal's price for screens and emails — null when it can't be priced right now. */
export async function renewalPriceNgn(domain: string): Promise<number | null> {
  try {
    return (await quoteDomain(domain, 'renew')).ngnPrice;
  } catch {
    return null;
  }
}
