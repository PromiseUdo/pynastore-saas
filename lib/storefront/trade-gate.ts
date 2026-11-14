/*
 * lib/storefront/trade-gate.ts
 *
 * The "Trade only" gate (ROADMAP 21.1). A shop whose merchant chose Trade
 * only shows its catalogue — products, prices, categories, search — to
 * approved trade buyers and to its own team, and to nobody else.
 *
 * Enforced where the catalogue is loaded (./data/current.ts), so every page,
 * every /api/storefront route, the sitemap and checkout get nothing for
 * anyone else: there is no second place that could forget. The store layout
 * reads the same answer to show "This shop sells to businesses" instead of
 * an empty shop. Server only.
 */
import { cache } from 'react';
import { getWholesaleSettingsBySlug, isTradeBuyer } from '@/lib/trade/accounts';
import { getShopperForStore } from './account/session';
import { isTeamMember } from './opening';

export interface TradeGate {
  /** the shop is Trade only */
  tradeOnly: boolean;
  /** the person looking may see the catalogue */
  allowed: boolean;
}

export const getTradeGate = cache(async (organizationSlug: string): Promise<TradeGate> => {
  const settings = await getWholesaleSettingsBySlug(organizationSlug);
  if (settings.mode !== 'TRADE_ONLY' || !settings.organizationId) return { tradeOnly: false, allowed: true };
  const organizationId = settings.organizationId;
  try {
    const shopper = await getShopperForStore(organizationSlug);
    if (shopper && shopper.organizationId === organizationId && (await isTradeBuyer(organizationId, shopper.id))) {
      return { tradeOnly: true, allowed: true };
    }
    return { tradeOnly: true, allowed: await isTeamMember(organizationId) };
  } catch {
    // Outside a request (a script), or the session can't be read: nobody is let in.
    return { tradeOnly: true, allowed: false };
  }
});
