/* /platform/app-icon/{180|192|512} — the installed console's icon (ROADMAP 18.3). */
import { PLATFORM_NAME } from '@/lib/brand';
import { appIconResponse, appIconSize, PLATFORM_ICON_COLOUR } from '@/lib/pwa/app-icon';

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = appIconSize((await params).size);
  if (!size) return new Response(null, { status: 404 });
  return appIconResponse({ size, name: PLATFORM_NAME, background: PLATFORM_ICON_COLOUR, foreground: '#ffffff' });
}
