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
import { readSocialLinks, type SocialPlatform } from '../social-links';
import type { HeroSlide } from '../types';

export interface StorefrontLook {
  /** one line for search results and link previews — never shown on the page */
  tagline: string | null;
  socialImageUrl: string | null;
  analytics: { gaId: string | null; metaPixelId: string | null };
  hero: HeroSlide[];
  /** how to reach the shop, from Settings → General — only what is filled in */
  contact: { email: string | null; phone: string | null; address: string | null };
  /** the shop's own social profiles, in a fixed order — only those set */
  social: { platform: SocialPlatform; label: string; url: string }[];
}

const EMPTY: StorefrontLook = {
  tagline: null,
  socialImageUrl: null,
  analytics: { gaId: null, metaPixelId: null },
  hero: [],
  contact: { email: null, phone: null, address: null },
  social: [],
};

/*
 * The colour, fonts and light/dark default are the shop's DESIGN, read
 * separately (./design.ts) because a draft can be previewed.
 *
 * Memoised per request: the root layout reads it for the tracking tags, the shop layout for the header's
 * search and the footer's contact and social links, and the homepage for the
 * slides themselves. One query serves all of them.
 */
export const loadStorefrontLook = cache(async (organizationSlug: string): Promise<StorefrontLook> => {
  if (!organizationSlug) return EMPTY;

  const org = await prisma.organization.findFirst({
    where: { slug: organizationSlug, status: 'ACTIVE' },
    select: {
      storefrontTagline: true,
      storefrontSocialImageUrl: true,
      analyticsGaId: true,
      analyticsMetaPixelId: true,
      supportEmail: true,
      supportPhone: true,
      businessAddress: true,
      storefrontSocialLinks: true,
      heroSlides: {
        where: { isVisible: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });
  if (!org) return EMPTY;

  return {
    tagline: org.storefrontTagline?.trim() || null,
    socialImageUrl: org.storefrontSocialImageUrl,
    analytics: { gaId: org.analyticsGaId, metaPixelId: org.analyticsMetaPixelId },
    contact: {
      email: org.supportEmail?.trim() || null,
      phone: org.supportPhone?.trim() || null,
      address: org.businessAddress?.trim() || null,
    },
    social: readSocialLinks(org.storefrontSocialLinks),
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
