/*
 * lib/pwa/manifest.ts
 *
 * A web app manifest (ROADMAP 18.3): what lets a browser install the admin,
 * the platform console or a store to the Home Screen — and on an iPhone,
 * installing is what makes notifications possible at all. Each surface
 * serves its own from a route handler, because the manifest belongs to a
 * host and every one of ours is a different site (proxy.ts).
 */
import { APP_ICON_SIZES } from './app-icon';

export function manifestResponse(input: {
  name: string;
  shortName: string;
  /** where the installed app opens, and the part of the site it covers */
  startUrl: string;
  scope: string;
  /** the icon route, without the size: /app-icon or /platform/app-icon */
  iconBase: string;
  themeColor: string;
  backgroundColor?: string;
}): Response {
  const manifest = {
    id: input.startUrl,
    name: input.name,
    short_name: input.shortName,
    start_url: input.startUrl,
    scope: input.scope,
    display: 'standalone',
    theme_color: input.themeColor,
    background_color: input.backgroundColor ?? '#ffffff',
    icons: APP_ICON_SIZES.filter((size) => size !== 180).flatMap((size) => [
      { src: `${input.iconBase}/${size}`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' },
      { src: `${input.iconBase}/${size}`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'maskable' },
    ]),
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' },
  });
}

/** "Lagos Shoe Hub" → "Lagos Shoe…": a Home Screen label has room for about twelve characters. */
export function shortName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length <= 12 ? trimmed : `${trimmed.slice(0, 11).trimEnd()}…`;
}
