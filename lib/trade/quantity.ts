/*
 * lib/trade/quantity.ts
 *
 * Trade quantity rules (ROADMAP 21.3), in one place. Pure — the bag, the
 * product page, checkout and placing the order all use these, so they can't
 * disagree about what a trade buyer may order.
 *
 *   - a product's MINIMUM counts all its variants together: a shop buying 12
 *     tees may mix colours;
 *   - a PACK is per line — a carton holds one variant — so each line's
 *     quantity is a whole number of packs;
 *   - a shop's MINIMUM ORDER VALUE counts the goods before any discount and
 *     delivery: what the buyer is choosing to buy.
 *
 * None of it applies to anyone but an approved trade buyer: the catalogue
 * attaches `trade` rules to products only for them
 * (lib/storefront/data/from-prisma.ts), and a cart line carries them on.
 */
import type { CartItem, TradeQuantityRules } from '@/lib/storefront/types';
import { formatMoney } from '@/lib/storefront/format';

/** A trade buyer's ceiling per line, instead of a shopper's 99 — stock limits it further. */
export const TRADE_MAX_LINE_QUANTITY = 9_999;

export type { TradeQuantityRules };

/** A pack of 1 is no pack; a minimum of 1 is no minimum. */
export function cleanRules(minQuantity: number | null | undefined, packSize: number | null | undefined): TradeQuantityRules {
  return {
    minQuantity: minQuantity && minQuantity > 1 ? Math.floor(minQuantity) : null,
    packSize: packSize && packSize > 1 ? Math.floor(packSize) : null,
  };
}

/**
 * The quantity a line can actually hold: a whole number of packs, at least
 * one pack, never above `max` (stock, or the line ceiling). When even one
 * pack is more than `max`, the line can't be bought at all — the bag says
 * so (`tradeBagProblems`) rather than quietly selling a part pack.
 */
export function snapToPacks(quantity: number, rules: TradeQuantityRules | undefined, max: number): number {
  const pack = rules?.packSize ?? 1;
  const ceiling = Math.max(0, Math.floor(max));
  const wanted = Math.max(pack, Math.ceil(Math.max(1, Math.floor(quantity)) / pack) * pack);
  if (wanted <= ceiling) return wanted;
  const fits = Math.floor(ceiling / pack) * pack;
  return fits >= pack ? fits : pack;
}

/** The first quantity that meets the rules on its own: the minimum, rounded up to whole packs. */
export function firstTradeQuantity(rules: TradeQuantityRules | undefined): number {
  const pack = rules?.packSize ?? 1;
  const min = rules?.minQuantity ?? 1;
  return Math.ceil(Math.max(min, pack) / pack) * pack;
}

/** "Minimum 12 · in packs of 24", for beside a trade price. Null when there are no rules. */
export function describeRules(rules: TradeQuantityRules | undefined): string | null {
  if (!rules) return null;
  const parts = [
    rules.minQuantity ? `Minimum ${rules.minQuantity}` : null,
    rules.packSize ? `in packs of ${rules.packSize}` : null,
  ].filter(Boolean) as string[];
  if (!parts.length) return null;
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface TradeBagProblem {
  /** the line or product it's about; null for the whole bag */
  productId: string | null;
  message: string;
}

/**
 * What stops a trade buyer's bag from being ordered, in their words. Empty
 * when it's fine — and always empty for a bag with no trade lines.
 */
export function tradeBagProblems(
  items: Pick<CartItem, 'productId' | 'variantId' | 'name' | 'optionSummary' | 'quantity' | 'maxQuantity' | 'unitPrice' | 'currency' | 'trade'>[],
  /** minor units; null = no minimum */
  minOrderValue: number | null,
): TradeBagProblem[] {
  const trade = items.filter((item) => item.trade);
  if (!trade.length) return [];
  const problems: TradeBagProblem[] = [];

  // Whole packs, line by line.
  for (const item of trade) {
    const pack = item.trade?.packSize;
    if (!pack) continue;
    const label = item.optionSummary ? `${item.name} (${item.optionSummary})` : item.name;
    if (item.maxQuantity < pack) {
      problems.push({ productId: item.productId, message: `${label} is sold in packs of ${pack}, and there aren’t enough in stock for a pack.` });
    } else if (item.quantity % pack !== 0) {
      problems.push({ productId: item.productId, message: `${label} is sold in packs of ${pack}. Change the quantity to a multiple of ${pack}.` });
    }
  }

  // Each product's minimum, its variants together.
  const byProduct = new Map<string, { name: string; quantity: number; min: number }>();
  for (const item of trade) {
    const min = item.trade?.minQuantity;
    if (!min) continue;
    const entry = byProduct.get(item.productId) ?? { name: item.name, quantity: 0, min };
    entry.quantity += item.quantity;
    byProduct.set(item.productId, entry);
  }
  for (const [productId, entry] of byProduct) {
    if (entry.quantity < entry.min) {
      problems.push({ productId, message: `${entry.name}: order at least ${entry.min} (you have ${entry.quantity}).` });
    }
  }

  // The shop's minimum order, on the goods.
  if (minOrderValue && minOrderValue > 0) {
    const goods = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    if (goods < minOrderValue) {
      const currency = items[0]?.currency ?? 'NGN';
      problems.push({
        productId: null,
        message: `Trade orders start at ${formatMoney(minOrderValue, currency)} of goods. Add ${formatMoney(minOrderValue - goods, currency)} more to order.`,
      });
    }
  }
  return problems;
}
