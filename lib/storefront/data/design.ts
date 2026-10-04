/*
 * lib/storefront/data/design.ts
 *
 * Which design a storefront request renders with (ROADMAP 15.1).
 *
 *   - the published design, when the shop has one;
 *   - otherwise Classic, built from the older accent and dark-mode columns,
 *     so a shop that has never opened the editor looks exactly as before;
 *   - the draft instead, only when the caller has already established that
 *     this viewer may preview it (lib/storefront/design/preview.ts).
 *
 * A stored document that doesn't parse is treated as absent — the shop
 * falls back rather than failing.
 *
 * Server only.
 */
import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import { classicDesign, parseDesign, type StorefrontDesignConfig } from '../design/schema';
import { resolveDesign, type ResolvedDesign } from '../design/tokens';

export interface StorefrontDesignView {
  design: StorefrontDesignConfig;
  resolved: ResolvedDesign;
  /** true when this is the merchant's unpublished draft */
  isDraft: boolean;
}

const CLASSIC = classicDesign({ accent: null, darkByDefault: false });

export const loadStorefrontDesign = cache(
  async (organizationSlug: string, which: 'published' | 'draft' = 'published'): Promise<StorefrontDesignView> => {
    const org = organizationSlug
      ? await prisma.organization.findFirst({
          where: { slug: organizationSlug, status: { in: ['ACTIVE', 'SUSPENDED'] } },
          select: {
            storefrontAccent: true,
            storefrontDarkByDefault: true,
            storefrontDesign: { select: { draft: true, published: true } },
          },
        })
      : null;
    if (!org) return { design: CLASSIC, resolved: resolveDesign(CLASSIC), isDraft: false };

    const draft = which === 'draft' ? parseDesign(org.storefrontDesign?.draft) : null;
    const design =
      draft ??
      parseDesign(org.storefrontDesign?.published) ??
      classicDesign({ accent: org.storefrontAccent, darkByDefault: org.storefrontDarkByDefault });

    return { design, resolved: resolveDesign(design), isDraft: Boolean(draft) };
  },
);
