/*
 * The store app a store's well-known files describe (ROADMAP 18.5): only a
 * live store's app that isn't lapsed — a link must never open an app that
 * would only say it's no longer available.
 */
import { prisma } from '@/lib/prisma';

export async function liveStoreApp(organizationSlug: string) {
  const store = await prisma.organization.findFirst({
    where: { slug: organizationSlug, status: 'ACTIVE' },
    select: { mobileApp: { select: { appId: true, status: true, appleTeamId: true, apnsTeamId: true, androidCertSha256: true } } },
  });
  const app = store?.mobileApp;
  return app && app.status === 'ACTIVE' ? app : null;
}

/** JSON, at the exact address asked for (the phone follows no redirect), cached for an hour. */
export function wellKnownJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
}
