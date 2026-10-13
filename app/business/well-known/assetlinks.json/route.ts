/*
 * /.well-known/assetlinks.json on the business host (ROADMAP 19.5): links to
 * b.{root} open the business app on an Android phone that has it — the one
 * signed with these keys. Served at the exact address (proxy.ts).
 */
import { assetLinks, businessAppLinkSettings } from '@/lib/mobile/app-links';
import { BUSINESS_APP_ID } from '@/lib/mobile/app-config';
import { wellKnownJson } from '@/app/store/[organizationSlug]/well-known/store-app';

export function GET() {
  const file = assetLinks({ appId: BUSINESS_APP_ID, fingerprints: businessAppLinkSettings().fingerprints });
  return file ? wellKnownJson(file) : new Response(null, { status: 404 });
}
