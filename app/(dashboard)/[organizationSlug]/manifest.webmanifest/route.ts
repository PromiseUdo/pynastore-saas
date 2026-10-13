/*
 * /manifest.webmanifest on a shop's admin host — installing the admin as an
 * app (ROADMAP 18.3), so a merchant can get alerts on their phone. Under the
 * platform's own name and icon; it names no shop, so it loads without a
 * session (browsers fetch manifests without cookies, see proxy.ts).
 */
import { PLATFORM_NAME } from '@/lib/brand';
import { PLATFORM_ICON_COLOUR } from '@/lib/pwa/app-icon';
import { manifestResponse, shortName } from '@/lib/pwa/manifest';

export function GET() {
  return manifestResponse({
    name: PLATFORM_NAME,
    shortName: shortName(PLATFORM_NAME),
    startUrl: '/',
    scope: '/',
    iconBase: '/app-icon',
    themeColor: PLATFORM_ICON_COLOUR,
  });
}
