/*
 * /.well-known/apple-app-site-association on the business host (ROADMAP
 * 19.5): links to b.{root} open the business app on an iPhone that has it.
 * proxy.ts rewrites the well-known path here, signed in or not — Apple
 * fetches it without cookies and follows no redirect.
 */
import { appleAppSiteAssociation, businessAppLinkSettings } from '@/lib/mobile/app-links';
import { BUSINESS_APP_ID } from '@/lib/mobile/app-config';
import { wellKnownJson } from '@/app/store/[organizationSlug]/well-known/store-app';

export function GET() {
  const file = appleAppSiteAssociation({ appId: BUSINESS_APP_ID, teamId: businessAppLinkSettings().teamId }, 'whole-host');
  return file ? wellKnownJson(file) : new Response(null, { status: 404 });
}
