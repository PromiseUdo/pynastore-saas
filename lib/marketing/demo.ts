/*
 * lib/marketing/demo.ts
 *
 * The live demo shop the landing page links to ("Look around a live demo
 * shop"), set with DEMO_SHOP_URL — a real shop on the platform, filled with
 * sample products, that visitors can browse. Unset (or not an https
 * address), the link isn't shown: never a link to a shop that isn't there.
 */
export function getDemoShopUrl(): string | null {
  const raw = process.env.DEMO_SHOP_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
