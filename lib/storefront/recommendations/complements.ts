/*
 * Complementary products — "what goes WITH this", as opposed to "what is
 * LIKE this".
 *
 * Two real sources, never an invented pairing:
 *   • the merchant's own "Goes well with" categories (Category.companionIds,
 *     set in Inventory › Categories), read through the catalogue as
 *     getCompanionCategories();
 *   • what customers of this store actually bought together
 *     (getFrequentlyBoughtTogether — real orders and invoices).
 * Shared by the product page's companion rail and the bag's "Goes with items
 * in your bag", so the two can never disagree about what belongs together.
 *
 * Pure: no catalogue reads.
 */

/** Heading used when a category's rule has no title of its own. */
export const DEFAULT_COMPANION_TITLE = 'You may also need';

/** Heading for a rail built from real co-purchases. */
export const BOUGHT_TOGETHER_TITLE = 'Often bought together';

/**
 * Round-robin across lists so every source is represented before any
 * repeats — a rail that is a spread across companion aisles, not four socks.
 * Dedupes by id; preserves each list's own order.
 */
export function interleave<T extends { id: string }>(lists: T[][], limit: number): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (let depth = 0; out.length < limit; depth++) {
    let found = false;
    for (const list of lists) {
      if (out.length >= limit) break;
      const candidate = list[depth];
      if (!candidate) continue;
      found = true;
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      out.push(candidate);
    }
    if (!found) break;
  }
  return out;
}
