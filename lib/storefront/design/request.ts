/*
 * lib/storefront/design/request.ts
 *
 * Which design THIS storefront request shows — decided once per request and
 * shared by the root layout (look, colour, fonts) and the homepage (its
 * sections), so the two can never disagree about whether a draft is being
 * previewed.
 *
 * The draft only for a member carrying a valid preview cookie who is, right
 * now, on this shop's team with `storefront.design` (./preview.ts).
 * Everyone else gets the published design.
 *
 * Server only.
 */
import { cache } from 'react';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { loadStorefrontDesign, type StorefrontDesignView } from '../data/design';
import { PREVIEW_COOKIE, mayPreviewDesign, readPreviewToken } from './preview';

export const designForRequest = cache(async (organizationSlug: string): Promise<StorefrontDesignView> => {
  let draft = false;
  const token = readPreviewToken((await cookies()).get(PREVIEW_COOKIE)?.value);
  if (token && organizationSlug) {
    const organization = await prisma.organization.findUnique({
      where: { slug: organizationSlug },
      select: { id: true },
    });
    draft = organization ? await mayPreviewDesign(token, organization.id) : false;
  }
  return loadStorefrontDesign(organizationSlug, draft ? 'draft' : 'published');
});
