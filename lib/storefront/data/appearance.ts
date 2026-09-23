/*
 * lib/storefront/data/appearance.ts
 *
 * What the merchant has said their shop should look like.
 *
 * Every field is optional and every absence means "the storefront's own
 * default" — not a sentence, colour or picture chosen on the merchant's
 * behalf. A shop that has filled in nothing looks exactly as it did before
 * any of this existed.
 *
 * Server only.
 */
import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import { isHexColour } from '@/lib/marketing/announcement';
import type { HeroSlide } from '../types';

export interface StorefrontLook {
  /** #rrggbb, or null to keep the storefront's own brand colour */
  accent: string | null;
  /** one line for search results and link previews — never shown on the page */
  tagline: string | null;
  socialImageUrl: string | null;
  analytics: { gaId: string | null; metaPixelId: string | null };
  hero: HeroSlide[];
}

const EMPTY: StorefrontLook = {
  accent: null,
  tagline: null,
  socialImageUrl: null,
  analytics: { gaId: null, metaPixelId: null },
  hero: [],
};

/*
 * Memoised per request: the root layout reads it for the colour and the
 * tracking tags, the shop layout for whether the header should carry its own
 * search, and the homepage for the slides themselves. One query serves all
 * three.
 */
export const loadStorefrontLook = cache(async (organizationSlug: string): Promise<StorefrontLook> => {
  if (!organizationSlug) return EMPTY;

  const org = await prisma.organization.findFirst({
    where: { slug: organizationSlug, status: 'ACTIVE' },
    select: {
      storefrontAccent: true,
      storefrontTagline: true,
      storefrontSocialImageUrl: true,
      analyticsGaId: true,
      analyticsMetaPixelId: true,
      heroSlides: {
        where: { isVisible: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });
  if (!org) return EMPTY;

  return {
    // Validated on the way out as well as in: a colour reaches a `style`
    // attribute, and the check is cheap.
    accent: isHexColour(org.storefrontAccent) ? org.storefrontAccent : null,
    tagline: org.storefrontTagline?.trim() || null,
    socialImageUrl: org.storefrontSocialImageUrl,
    analytics: { gaId: org.analyticsGaId, metaPixelId: org.analyticsMetaPixelId },
    hero: org.heroSlides
      /* A slide with no headline is not a slide. Nothing is written to fill
       * the gap — it simply isn't shown. */
      .filter((slide) => slide.title.trim())
      .map((slide) => ({
        id: slide.id,
        eyebrow: slide.eyebrow ?? '',
        title: slide.title,
        subtitle: slide.subtitle ?? '',
        ctaLabel: slide.ctaLabel ?? '',
        // A button needs both halves; the storefront shows one only if it works.
        ctaHref: slide.ctaLabel && slide.ctaHref ? slide.ctaHref : '',
        imageUrl: slide.imageUrl ?? '',
        align: slide.align.toLowerCase() as HeroSlide['align'],
        theme: slide.theme.toLowerCase() as HeroSlide['theme'],
      })),
  };
});
