/*
 * /.well-known/assetlinks.json on a store's hosts (ROADMAP 18.5): tells
 * Android phones that links to this store may open its own app — the one
 * signed with these keys. Served at the exact address, never redirected
 * (proxy.ts).
 */
import { assetLinks } from '@/lib/mobile/app-links';
import { liveStoreApp, wellKnownJson } from '../store-app';

export async function GET(_request: Request, { params }: { params: Promise<{ organizationSlug: string }> }) {
  const app = await liveStoreApp((await params).organizationSlug);
  const file = app ? assetLinks({ appId: app.appId, fingerprints: app.androidCertSha256 }) : null;
  return file ? wellKnownJson(file) : new Response(null, { status: 404 });
}
