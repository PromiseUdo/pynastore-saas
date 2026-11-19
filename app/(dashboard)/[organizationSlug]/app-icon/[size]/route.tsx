/*
 * /app-icon/{180|192|512} on a shop's admin host — the installed admin's
 * icon (ROADMAP 18.3): the Pynastore app icon. Names no shop.
 */
import { appIconSize, platformAppIconPath } from '@/lib/pwa/app-icon';

export async function GET(request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = appIconSize((await params).size);
  if (!size) return new Response(null, { status: 404 });
  // The brand pack's app icon (public/brand), full-bleed so a phone can
  // round or mask it without a black edge.
  return Response.redirect(new URL(platformAppIconPath(size), request.url), 308);
}
