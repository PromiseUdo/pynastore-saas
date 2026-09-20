/*
 * Deterministic remote placeholder imagery for the dummy catalog.
 * Uses picsum.photos seeded URLs — stable across renders, no API key,
 * whitelisted in next.config.ts `images.remotePatterns`.
 */
export function img(seed: string, w = 800, h = 800): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;
}

export function avatar(seed: string, size = 96): string {
  return `https://i.pravatar.cc/${size}?u=${encodeURIComponent(seed)}`;
}
