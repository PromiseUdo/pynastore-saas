/*
 * /platform/manifest.webmanifest — installing the platform console as an app
 * (ROADMAP 18.3), so staff get alerts on their phone. It covers /platform
 * only. Loads without a session, like every manifest (proxy.ts).
 */
import { PLATFORM_NAME } from '@/lib/brand';
import { PLATFORM_ICON_COLOUR } from '@/lib/pwa/app-icon';
import { manifestResponse } from '@/lib/pwa/manifest';

export function GET() {
  return manifestResponse({
    name: `${PLATFORM_NAME} console`,
    shortName: 'Console',
    startUrl: '/platform',
    scope: '/platform',
    iconBase: '/platform/app-icon',
    themeColor: PLATFORM_ICON_COLOUR,
  });
}
