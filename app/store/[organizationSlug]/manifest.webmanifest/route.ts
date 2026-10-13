/*
 * /manifest.webmanifest, per store — adding the shop to a Home Screen
 * (ROADMAP 18.3), under its own name, logo and brand colour (Phase 15's
 * look). A route handler for the same reason as robots.txt here: Next's
 * manifest convention only registers at the root of app/.
 */
import { prisma } from '@/lib/prisma';
import { getStorefrontDesign } from '@/lib/storefront/catalog';
import { isHex } from '@/lib/storefront/design/colour';
import { manifestResponse, shortName } from '@/lib/pwa/manifest';

/** The storefront's default accent when the merchant hasn't chosen one. */
const DEFAULT_THEME = '#111111';

export async function GET(_request: Request, { params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const store = await prisma.organization.findFirst({
    where: { slug: organizationSlug, status: 'ACTIVE', storefrontOpen: true },
    select: { name: true },
  });
  if (!store) return new Response(null, { status: 404 });
  const { design } = await getStorefrontDesign({ organizationSlug });

  return manifestResponse({
    name: store.name,
    shortName: shortName(store.name),
    startUrl: '/',
    scope: '/',
    iconBase: '/app-icon',
    themeColor: isHex(design.brandColour) ? design.brandColour : DEFAULT_THEME,
  });
}
