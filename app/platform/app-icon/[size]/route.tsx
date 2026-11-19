/* /platform/app-icon/{180|192|512} — the installed console's icon (ROADMAP 18.3). */
import { appIconSize, platformAppIconPath } from '@/lib/pwa/app-icon';

export async function GET(request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = appIconSize((await params).size);
  if (!size) return new Response(null, { status: 404 });
  // The brand pack's app icon (public/brand), full-bleed so a phone can
  // round or mask it without a black edge.
  return Response.redirect(new URL(platformAppIconPath(size), request.url), 308);
}
