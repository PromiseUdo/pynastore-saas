/*
 * lib/storefront/sections/schema.ts
 *
 * The shop's front page as a list of sections (ROADMAP 15.2). Pure and
 * client-safe: the storefront renders from it, and the homepage editor
 * (15.3) will edit it.
 *
 * Every section type has a known shape — a discriminated union, strict, so
 * a section can't carry anything its renderer doesn't understand. Order is
 * the order of the array. Product bands name a SOURCE (bestselling, newest,
 * a tag, a collection, a category, a brand) and never pick products
 * themselves; lib/storefront/catalog.ts resolves the source.
 *
 * `classicSections()` is the front page every shop had before sections
 * existed, in the same order — so a shop that hasn't arranged its own gets
 * exactly that.
 *
 * ADDING TO A SECTION. A new field on an existing type takes a `.default()`
 * equal to how it rendered before (15.4's `variant`s), so every stored
 * document still parses and still looks the same — no design version bump.
 * A change that ISN'T expressible as a default is a new design version
 * (lib/storefront/design/schema.ts).
 */
import { z } from 'zod';
import type { ProductTag } from '../types';

/** The product tags a band may be built from — the merchant's own tags. */
export const SECTION_TAGS = ['new', 'featured', 'bestseller', 'sale', 'deal-of-day', 'trending', 'limited'] as const satisfies readonly ProductTag[];

const id = z.string().regex(/^[a-z0-9-]{1,40}$/, 'A section id is lowercase letters, numbers and dashes');

export const SourceSchema = z.discriminatedUnion('kind', [
  /** the products tagged Bestseller, or the best sellers by sales when none are */
  z.object({ kind: z.literal('bestselling') }).strict(),
  /** newest first */
  z.object({ kind: z.literal('newest') }).strict(),
  z.object({ kind: z.literal('tag'), tag: z.enum(SECTION_TAGS) }).strict(),
  z.object({ kind: z.literal('collection'), id: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal('category'), id: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal('brand'), id: z.string().min(1).max(64) }).strict(),
]);
export type SectionSource = z.output<typeof SourceSchema>;

const base = { id, enabled: z.boolean() };

/** A link inside the shop: a path starting with one "/" — never another site. */
export const shopPath = z
  .string()
  .trim()
  .max(300)
  .regex(/^(\/(?!\/)[^\s]*)?$/, 'A link has to be a page on your shop, starting with /');

/** A picture the merchant uploaded — Cloudinary only; the save action checks it is this shop's. */
const uploadedImage = z
  .object({
    url: z.string().url().max(500).startsWith('https://res.cloudinary.com/', 'Upload the picture here'),
    publicId: z.string().min(1).max(200),
  })
  .strict();

export const SectionSchema = z.discriminatedUnion('type', [
  /** the top of the page: the merchant's slides, or the discovery hero */
  z
    .object({
      ...base,
      type: z.literal('hero'),
      /** how slides are laid out: words over the picture, or beside it (15.4) */
      variant: z.enum(['full', 'split']).default('full'),
    })
    .strict(),
  z.object({ ...base, type: z.literal('shopping-missions') }).strict(),
  /** "Recommended for you" — the Recommendation Service decides what */
  z.object({ ...base, type: z.literal('recommended') }).strict(),
  /** the shopper's own recently viewed; renders nothing on a first visit */
  z.object({ ...base, type: z.literal('recently-viewed') }).strict(),
  z
    .object({
      ...base,
      type: z.literal('products'),
      /** a scrolling row, a grid, or one large product beside a grid (15.4) */
      variant: z.enum(['carousel', 'grid', 'feature']),
      title: z.string().trim().min(1, 'Give the section a heading').max(60),
      source: SourceSchema,
    })
    .strict(),
  z.object({ ...base, type: z.literal('price-explorer') }).strict(),
  /** the product tagged Deal of the day, if there is one */
  z.object({ ...base, type: z.literal('deal-of-the-day') }).strict(),
  /** the featured top-level categories */
  z
    .object({
      ...base,
      type: z.literal('category-showcase'),
      variant: z.enum(['tiles', 'circles', 'list']).default('tiles'),
    })
    .strict(),
  /** what this store's settings actually promise — delivery, returns, payment */
  z.object({ ...base, type: z.literal('service-features') }).strict(),
  /**
   * A picture and the merchant's own words (15.4) — "Our story", "Made in
   * Lagos". Plain text, never HTML; a button only with both halves.
   */
  z
    .object({
      ...base,
      type: z.literal('image-text'),
      heading: z.string().trim().min(1, 'Give the section a heading').max(80),
      body: z.string().trim().max(600, 'Keep it under 600 characters').default(''),
      image: uploadedImage.nullable().default(null),
      imageSide: z.enum(['left', 'right']).default('left'),
      buttonLabel: z.string().trim().max(40).default(''),
      buttonHref: shopPath.default(''),
    })
    .strict()
    .refine((s) => Boolean(s.buttonLabel) === Boolean(s.buttonHref), {
      message: 'A button needs both its words and where it goes',
    }),
  /** the shop's brands that have something on sale (15.4) */
  z.object({ ...base, type: z.literal('brands') }).strict(),
  /** recent 4- and 5-star reviews from verified buyers; hidden when there are none (15.4) */
  z.object({ ...base, type: z.literal('reviews') }).strict(),
]);
export type HomepageSection = z.output<typeof SectionSchema>;
export type SectionType = HomepageSection['type'];

export const MAX_SECTIONS = 24;

export const SectionListSchema = z
  .array(SectionSchema)
  .min(1)
  .max(MAX_SECTIONS, `A front page can have up to ${MAX_SECTIONS} sections`)
  .superRefine((sections, issue) => {
    /* The hero is the page's opening and the only place the discovery tools
     * (guided narrowing, image search) and the assistant are mounted — the
     * mission and budget tiles publish to it. So it is always there, and
     * always first. */
    if (sections[0]?.type !== 'hero' || !sections[0].enabled) {
      issue.addIssue({ code: 'custom', message: 'The front page always opens with its top section' });
    }
    if (sections.filter((s) => s.type === 'hero').length > 1) {
      issue.addIssue({ code: 'custom', message: 'A front page has one top section' });
    }
    const ids = new Set<string>();
    for (const section of sections) {
      if (ids.has(section.id)) issue.addIssue({ code: 'custom', message: 'Two sections share an id' });
      ids.add(section.id);
    }
  });

/** The front page before sections existed, section for section. */
export function classicSections(): HomepageSection[] {
  return [
    { id: 'hero', type: 'hero', enabled: true, variant: 'full' },
    { id: 'missions', type: 'shopping-missions', enabled: true },
    { id: 'for-you', type: 'recommended', enabled: true },
    { id: 'recently-viewed', type: 'recently-viewed', enabled: true },
    {
      id: 'popular',
      type: 'products',
      enabled: true,
      variant: 'carousel',
      title: 'Popular right now',
      source: { kind: 'bestselling' },
    },
    { id: 'budget', type: 'price-explorer', enabled: true },
    { id: 'deal', type: 'deal-of-the-day', enabled: true },
    {
      id: 'new-arrivals',
      type: 'products',
      enabled: true,
      variant: 'grid',
      title: 'New arrivals',
      source: { kind: 'newest' },
    },
    { id: 'categories', type: 'category-showcase', enabled: true, variant: 'tiles' },
    { id: 'promises', type: 'service-features', enabled: true },
  ];
}

/* ─── For the homepage editor (15.3) ──────────────────────────────────── */

export interface SectionInfo {
  /** what the merchant calls it */
  label: string;
  /** one line on what it shows and where that comes from */
  description: string;
  /** only one of these makes sense on a page */
  single: boolean;
}

export const SECTION_INFO: Record<SectionType, SectionInfo> = {
  hero: {
    label: 'Top of the page',
    description: 'Your slides if you have any, otherwise search and guided browsing. Always first.',
    single: true,
  },
  'shopping-missions': {
    label: 'Shop by what you’re doing',
    description: 'Tiles for occasions, cutting across your categories.',
    single: true,
  },
  recommended: {
    label: 'Recommended for you',
    description: 'Picked for each shopper from what they browse. Never repeats a band above or below it.',
    single: true,
  },
  'recently-viewed': {
    label: 'Continue exploring',
    description: 'What this shopper looked at last. Hidden on a first visit.',
    single: true,
  },
  products: {
    label: 'Product band',
    description: 'A row or grid of products from a source you choose.',
    single: false,
  },
  'price-explorer': {
    label: 'Shop by budget',
    description: 'Price ranges worked out from what you sell.',
    single: true,
  },
  'deal-of-the-day': {
    label: 'Deal of the day',
    description: 'The product you tagged “Deal of the day”. Hidden when none is.',
    single: true,
  },
  'category-showcase': {
    label: 'Shop by category',
    description: 'The categories you marked as featured.',
    single: true,
  },
  'service-features': {
    label: 'What your shop promises',
    description: 'Delivery, returns and payment — from your settings, never typed.',
    single: true,
  },
  'image-text': {
    label: 'Image and text',
    description: 'A picture with your own words and an optional button — your story, a promise, a launch.',
    single: false,
  },
  brands: {
    label: 'Brands',
    description: 'The brands you sell, with their logos. Only brands with something on sale appear.',
    single: true,
  },
  reviews: {
    label: 'What customers say',
    description: 'Recent 4- and 5-star reviews from customers whose orders were delivered. Hidden until you have some.',
    single: true,
  },
};

/** A fresh id for a new section, unlike any already on the page. */
export function newSectionId(type: SectionType, taken: Iterable<string>): string {
  const used = new Set(taken);
  const stem = type === 'products' ? 'band' : type;
  for (let n = 1; ; n++) {
    const candidate = n === 1 && type !== 'products' ? stem : `${stem}-${n}`;
    if (!used.has(candidate) && candidate.length <= 40) return candidate;
  }
}

/** A new section of this type with sensible defaults. */
export function newSection(type: SectionType, taken: Iterable<string>): HomepageSection {
  const id = newSectionId(type, taken);
  if (type === 'products') {
    return { id, type, enabled: true, variant: 'carousel', title: 'New arrivals', source: { kind: 'newest' } };
  }
  if (type === 'image-text') {
    /* No heading or words are written for the merchant: the form asks for
     * them, and the section can't be saved without a heading. */
    return { id, type, enabled: true, heading: '', body: '', image: null, imageSide: 'left', buttonLabel: '', buttonHref: '' };
  }
  if (type === 'hero') return { id, type, enabled: true, variant: 'full' };
  if (type === 'category-showcase') return { id, type, enabled: true, variant: 'tiles' };
  return { id, type, enabled: true } as HomepageSection;
}
