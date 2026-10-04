import { describe, expect, it } from 'vitest';
import { classicSections, SectionListSchema, SourceSchema, MAX_SECTIONS, type HomepageSection } from './schema';
import { parseDesign } from '../design/schema';

const parse = (sections: unknown) => SectionListSchema.safeParse(sections);
const products = (over: Record<string, unknown> = {}) => ({
  id: 'band',
  type: 'products',
  enabled: true,
  variant: 'grid',
  title: 'Dresses',
  source: { kind: 'newest' },
  ...over,
});

describe('classicSections', () => {
  it('is the front page every shop had, in the same order', () => {
    expect(classicSections().map((s) => (s.type === 'products' ? `products:${s.source.kind}` : s.type))).toEqual([
      'hero',
      'shopping-missions',
      'recommended',
      'recently-viewed',
      'products:bestselling',
      'price-explorer',
      'deal-of-the-day',
      'products:newest',
      'category-showcase',
      'service-features',
    ]);
  });

  it('passes its own rules', () => {
    expect(parse(classicSections()).success).toBe(true);
  });
});

describe('SectionListSchema', () => {
  const hero: HomepageSection = { id: 'hero', type: 'hero', enabled: true, variant: 'full' };

  it('always opens with the top section, enabled, and only one of it', () => {
    expect(parse([products()]).success).toBe(false);
    expect(parse([products(), hero]).success).toBe(false);
    expect(parse([{ ...hero, enabled: false }, products()]).success).toBe(false);
    expect(parse([hero, { ...hero, id: 'hero-2' }]).success).toBe(false);
    expect(parse([hero, products()]).success).toBe(true);
  });

  it('refuses two sections with one id, or too many sections', () => {
    expect(parse([hero, products(), products()]).success).toBe(false);
    const many = Array.from({ length: MAX_SECTIONS }, (_, i) => products({ id: `band-${i}` }));
    expect(parse([hero, ...many]).success).toBe(false);
  });

  it('refuses a type it doesn’t know, or anything a renderer wouldn’t understand', () => {
    expect(parse([hero, { id: 'x', type: 'raw-html', enabled: true, html: '<script>' }]).success).toBe(false);
    expect(parse([hero, products({ html: '<b>' })]).success).toBe(false);
    expect(parse([hero, products({ variant: 'masonry' })]).success).toBe(false);
    expect(parse([hero, products({ title: '' })]).success).toBe(false);
    expect(parse([hero, products({ id: 'Not An Id' })]).success).toBe(false);
  });

  it('only accepts sources it can resolve', () => {
    expect(SourceSchema.safeParse({ kind: 'tag', tag: 'sale' }).success).toBe(true);
    expect(SourceSchema.safeParse({ kind: 'tag', tag: 'clearance' }).success).toBe(false);
    expect(SourceSchema.safeParse({ kind: 'collection', id: 'c1' }).success).toBe(true);
    expect(SourceSchema.safeParse({ kind: 'collection' }).success).toBe(false);
    expect(SourceSchema.safeParse({ kind: 'everything' }).success).toBe(false);
  });
});

describe('designs and sections', () => {
  const v1 = {
    version: 1,
    look: 'minimal',
    brandColour: null,
    darkByDefault: false,
    corners: null,
    fonts: null,
    cards: null,
  };

  it('upgrades a 15.1 design (v1) to v2 with the Classic front page', () => {
    expect(parseDesign(v1)).toMatchObject({ version: 2, look: 'minimal', sections: null });
  });

  it('keeps a valid section list, and drops a design whose sections break the rules', () => {
    const sections = classicSections().slice(0, 3);
    expect(parseDesign({ ...v1, version: 2, sections })?.sections).toEqual(sections);
    expect(parseDesign({ ...v1, version: 2, sections: [products()] })).toBeNull();
  });
});

describe('15.4 — layouts and new sections', () => {
  const hero = { id: 'hero', type: 'hero', enabled: true };
  const imageText = (over: Record<string, unknown> = {}) => ({
    id: 'story',
    type: 'image-text',
    enabled: true,
    heading: 'Made by hand in Abeokuta',
    ...over,
  });

  it('reads sections saved before layouts existed exactly as they looked', () => {
    const parsed = SectionListSchema.parse([hero, { id: 'categories', type: 'category-showcase', enabled: true }]);
    expect(parsed[0]).toMatchObject({ type: 'hero', variant: 'full' });
    expect(parsed[1]).toMatchObject({ type: 'category-showcase', variant: 'tiles' });
  });

  it('knows the new layouts and refuses made-up ones', () => {
    expect(parse([{ ...hero, variant: 'split' }]).success).toBe(true);
    expect(parse([{ ...hero, variant: 'video' }]).success).toBe(false);
    expect(parse([hero, products({ variant: 'feature' })]).success).toBe(true);
    expect(parse([hero, { id: 'c', type: 'category-showcase', enabled: true, variant: 'circles' }]).success).toBe(true);
  });

  it('takes the merchant’s own words and picture, as plain values only', () => {
    const ok = SectionListSchema.parse([hero, imageText({ body: 'Line one\nLine two' })]);
    expect(ok[1]).toMatchObject({ body: 'Line one\nLine two', image: null, imageSide: 'left', buttonLabel: '', buttonHref: '' });
    expect(parse([hero, imageText({ heading: '  ' })]).success).toBe(false);
    expect(parse([hero, imageText({ body: 'x'.repeat(601) })]).success).toBe(false);
    expect(parse([hero, imageText({ html: '<b>hi</b>' })]).success).toBe(false);
  });

  it('only links a button to a page on the shop, and only with both halves', () => {
    expect(parse([hero, imageText({ buttonLabel: 'Read more', buttonHref: '/pages/about' })]).success).toBe(true);
    expect(parse([hero, imageText({ buttonLabel: 'Read more' })]).success).toBe(false);
    expect(parse([hero, imageText({ buttonHref: '/pages/about' })]).success).toBe(false);
    for (const href of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '/a b']) {
      expect(parse([hero, imageText({ buttonLabel: 'Go', buttonHref: href })]).success).toBe(false);
    }
  });

  it('only shows a picture uploaded to the platform’s image host', () => {
    const image = (url: string) => imageText({ image: { url, publicId: 'mansaas/org/storefront/x' } });
    expect(parse([hero, image('https://res.cloudinary.com/demo/image/upload/v1/x.jpg')]).success).toBe(true);
    expect(parse([hero, image('https://evil.example/x.jpg')]).success).toBe(false);
  });

  it('has brands and customer reviews as one-of sections', () => {
    expect(parse([hero, { id: 'brands', type: 'brands', enabled: true }, { id: 'reviews', type: 'reviews', enabled: true }]).success).toBe(true);
  });
});
