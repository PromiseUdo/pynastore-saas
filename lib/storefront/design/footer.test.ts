import { describe, expect, it } from 'vitest';
import { arrangeFooter, type BuiltFooterColumn } from './footer';
import { DesignSchema, classicFooter, parseDesign, sameLook, type FooterConfig } from './schema';

const col = (title: string): BuiltFooterColumn => ({ title, links: [{ label: `${title} link`, href: '/x' }] });
const derived = { shop: col('Shop'), account: col('Your account'), help: col('Help'), about: col('About us') };
const titles = (columns: BuiltFooterColumn[]) => columns.map((c) => c.title);

describe('arrangeFooter', () => {
  it('is the Classic footer with no setting — the same four, in the same order', () => {
    expect(titles(arrangeFooter(null, derived))).toEqual(['Shop', 'Your account', 'Help', 'About us']);
    expect(titles(arrangeFooter(classicFooter(), derived))).toEqual(['Shop', 'Your account', 'Help', 'About us']);
  });

  it('follows the shop’s order and leaves hidden columns out', () => {
    const footer: FooterConfig = {
      columns: [
        { key: 'about', enabled: true },
        { key: 'shop', enabled: true },
        { key: 'account', enabled: false },
        { key: 'help', enabled: true },
      ],
    };
    expect(titles(arrangeFooter(footer, derived))).toEqual(['About us', 'Shop', 'Help']);
  });

  it('never shows Help or About without a published page, whatever the setting says', () => {
    expect(titles(arrangeFooter(null, { ...derived, help: null, about: null }))).toEqual(['Shop', 'Your account']);
  });

  it('adds the merchant’s own column where they put it, only when it has a heading and links', () => {
    const own = (enabled: boolean, links: { label: string; href: string }[]) => ({
      columns: [
        { key: 'shop' as const, enabled: true },
        { key: 'links' as const, enabled, title: 'Good to know', links },
      ],
    });
    const result = arrangeFooter(own(true, [{ label: 'Our story', href: '/pages/about' }]), derived);
    expect(result[1]).toEqual({ title: 'Good to know', links: [{ label: 'Our story', href: '/pages/about' }] });
    expect(titles(arrangeFooter(own(false, [{ label: 'Our story', href: '/pages/about' }]), derived))).toEqual(['Shop']);
  });
});

describe('header and footer in the design', () => {
  const v2 = {
    version: 2,
    look: 'classic',
    brandColour: null,
    darkByDefault: false,
    corners: null,
    fonts: null,
    cards: null,
    sections: null,
  };
  const withFooter = (footer: unknown) => DesignSchema.safeParse({ ...v2, footer });

  it('reads a design saved before headers and footers existed as the old ones', () => {
    expect(parseDesign(v2)).toMatchObject({ header: { layout: 'standard' }, footer: null });
  });

  it('knows the three header layouts and nothing else', () => {
    expect(DesignSchema.safeParse({ ...v2, header: { layout: 'centered' } }).success).toBe(true);
    expect(DesignSchema.safeParse({ ...v2, header: { layout: 'mega-menu' } }).success).toBe(false);
  });

  it('refuses a footer that repeats a column, links off the shop, or has an empty shown column of its own', () => {
    expect(withFooter({ columns: [{ key: 'shop', enabled: true }, { key: 'shop', enabled: false }] }).success).toBe(false);
    const own = (over: Record<string, unknown>) => withFooter({ columns: [{ key: 'links', enabled: true, title: 'More', links: [{ label: 'Story', href: '/pages/about' }], ...over }] });
    expect(own({}).success).toBe(true);
    expect(own({ title: '' }).success).toBe(false);
    expect(own({ links: [] }).success).toBe(false);
    expect(own({ enabled: false, title: '', links: [] }).success).toBe(true);
    for (const href of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '']) {
      expect(own({ links: [{ label: 'Go', href }] }).success).toBe(false);
    }
    expect(own({ links: Array.from({ length: 7 }, (_, i) => ({ label: `L${i}`, href: '/products' })) }).success).toBe(false);
    expect(withFooter({ columns: [{ key: 'shop', enabled: true, html: '<b>' }] }).success).toBe(false);
  });

  it('compares the look alone for the Look tab', () => {
    const a = DesignSchema.parse(v2);
    expect(sameLook(a, { ...a, header: { layout: 'search' }, footer: classicFooter() })).toBe(true);
    expect(sameLook(a, { ...a, look: 'bold' })).toBe(false);
  });
});
