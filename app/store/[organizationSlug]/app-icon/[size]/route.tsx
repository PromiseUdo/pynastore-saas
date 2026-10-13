/*
 * /app-icon/{180|192|512}, per store — the shop's Home Screen icon (ROADMAP
 * 18.3): its logo, or its initial on its brand colour.
 */
import { prisma } from '@/lib/prisma';
import { getStorefrontDesign } from '@/lib/storefront/catalog';
import { isHex, textOn } from '@/lib/storefront/design/colour';
import { appIconResponse, appIconSize } from '@/lib/pwa/app-icon';

export async function GET(_request: Request, { params }: { params: Promise<{ organizationSlug: string; size: string }> }) {
  const { organizationSlug, size: raw } = await params;
  const size = appIconSize(raw);
  if (!size) return new Response(null, { status: 404 });
  const store = await prisma.organization.findFirst({
    where: { slug: organizationSlug, status: 'ACTIVE', storefrontOpen: true },
    select: { name: true, logoUrl: true },
  });
  if (!store) return new Response(null, { status: 404 });
  const { design } = await getStorefrontDesign({ organizationSlug });
  const background = isHex(design.brandColour) ? design.brandColour : '#111111';
  return appIconResponse({ size, name: store.name, logoUrl: store.logoUrl, background, foreground: textOn(background) });
}
