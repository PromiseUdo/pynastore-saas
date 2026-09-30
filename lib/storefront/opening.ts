/*
 * lib/storefront/opening.ts
 *
 * Whether a shop is open to shoppers yet (ROADMAP 12.5), and whether the
 * person looking may preview it anyway. A new shop starts not open: shoppers
 * see "Opening soon", the catalogue lists nothing, search engines are kept
 * out and no order is taken. The merchant's own team — anyone signed in with
 * an active membership — sees the real shop with a preview banner, so they
 * can look before opening. (The admin session cookie is scoped to the root
 * domain, so it reaches the storefront host.)
 *
 * Server only. The auth stack is loaded only when a shop is closed, so the
 * storefront's many open-shop requests (and its tests) never touch it.
 */
import { cache } from 'react';
import { prisma } from '@/lib/prisma';

export interface StorefrontOpening {
  open: boolean;
  /** not open, but the viewer is on the merchant's team */
  previewer: boolean;
  /** it has been open before — closed again, say for a holiday */
  everOpened: boolean;
}

export const getStorefrontOpening = cache(async (organizationSlug: string): Promise<StorefrontOpening> => {
  const org = await prisma.organization.findUnique({
    where: { slug: organizationSlug },
    select: { id: true, storefrontOpen: true, storefrontOpenedAt: true },
  });
  if (!org) return { open: false, previewer: false, everOpened: false };
  if (org.storefrontOpen) return { open: true, previewer: false, everOpened: true };
  return { open: false, previewer: await isTeamMember(org.id), everOpened: Boolean(org.storefrontOpenedAt) };
});

async function isTeamMember(organizationId: string): Promise<boolean> {
  try {
    const { auth } = await import('@/lib/auth');
    const userId = (await auth())?.user?.id;
    if (!userId) return false;
    return (await prisma.membership.count({ where: { userId, organizationId, status: 'ACTIVE' } })) > 0;
  } catch {
    // Outside a request (a script), or the session can't be read: no preview.
    return false;
  }
}
