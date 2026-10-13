/*
 * /.well-known/apple-app-site-association on a store's hosts (ROADMAP 18.5):
 * tells iPhones that links to this store may open its own app. proxy.ts
 * rewrites the well-known path here and never redirects it — Apple fetches
 * it once per host and follows no redirect.
 */
import { appleAppSiteAssociation } from '@/lib/mobile/app-links';
import { liveStoreApp, wellKnownJson } from '../store-app';

export async function GET(_request: Request, { params }: { params: Promise<{ organizationSlug: string }> }) {
  const app = await liveStoreApp((await params).organizationSlug);
  const file = app ? appleAppSiteAssociation({ appId: app.appId, teamId: app.appleTeamId ?? app.apnsTeamId }) : null;
  return file ? wellKnownJson(file) : new Response(null, { status: 404 });
}
