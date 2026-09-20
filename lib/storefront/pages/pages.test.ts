import { describe, it, expect } from 'vitest';
import { parsePageBody, parseInline, safeHref, pageExcerpt, pageOutline, inlineText } from './format';
import {
  checkoutPageLinks,
  footerPageLinks,
  hasSizeOption,
  isValidPageSlug,
  pageSlugFrom,
  uniquePageSlug,
  type StorePageLink,
} from './rules';

const link = (kind: StorePageLink['kind'], title: string, slug: string): StorePageLink => ({
  kind,
  title,
  slug,
  href: `/pages/${slug}`,
});

describe('safeHref', () => {
  it('allows web, email, phone and in-store addresses', () => {
    expect(safeHref('https://example.com/a')).toEqual({ href: 'https://example.com/a', external: true });
    expect(safeHref('/products')).toEqual({ href: '/products', external: false });
    expect(safeHref('mailto:hi@shop.ng')?.href).toBe('mailto:hi@shop.ng');
    expect(safeHref('tel:+2348012345678')?.href).toBe('tel:+2348012345678');
  });

  it('refuses anything that could run script or leave by a side door', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('JAVASCRIPT:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>')).toBeNull();
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref('vbscript:x')).toBeNull();
  });
});

describe('parseInline', () => {
  it('reads bold and links', () => {
    expect(parseInline('Call **us** on [our line](tel:08012345678).')).toEqual([
      { type: 'text', text: 'Call ' },
      { type: 'strong', children: [{ type: 'text', text: 'us' }] },
      { type: 'text', text: ' on ' },
      { type: 'link', href: 'tel:08012345678', external: false, children: [{ type: 'text', text: 'our line' }] },
      { type: 'text', text: '.' },
    ]);
  });

  it('keeps the words of an unsafe link but drops the link', () => {
    expect(parseInline('[click me](javascript:alert(1))')).toEqual([{ type: 'text', text: 'click me)' }]);
    expect(parseInline('[click](javascript:void)')).toEqual([{ type: 'text', text: 'click' }]);
  });

  it('turns bare web and email addresses into links, leaving trailing punctuation out', () => {
    const nodes = parseInline('Email hello@shop.ng or see https://shop.ng/help.');
    expect(nodes).toContainEqual({
      type: 'link',
      href: 'mailto:hello@shop.ng',
      external: false,
      children: [{ type: 'text', text: 'hello@shop.ng' }],
    });
    expect(nodes).toContainEqual({
      type: 'link',
      href: 'https://shop.ng/help',
      external: true,
      children: [{ type: 'text', text: 'https://shop.ng/help' }],
    });
    expect(inlineText(nodes)).toBe('Email hello@shop.ng or see https://shop.ng/help.');
  });

  it('never produces markup from what the merchant typed', () => {
    const nodes = parseInline('<script>alert(1)</script> <b>hi</b>');
    expect(nodes).toEqual([{ type: 'text', text: '<script>alert(1)</script> <b>hi</b>' }]);
  });
});

describe('parsePageBody', () => {
  it('splits headings, paragraphs, lists and tables', () => {
    const blocks = parsePageBody(
      [
        '# Delivery',
        'We deliver in Lagos.',
        'Open Mon–Sat.',
        '',
        '- Lagos: 1–2 days',
        '* Abuja: 3 days',
        '',
        '1. Pack it',
        '2) Send it',
        '',
        '### Sizes',
        '| Size | Chest |',
        '| --- | --- |',
        '| S | 90 |',
        '| M |',
      ].join('\n'),
    );

    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'heading', 'table']);
    expect(blocks[0]).toMatchObject({ level: 2, id: 'delivery' });
    // a single line break inside a paragraph is kept
    expect(blocks[1]).toMatchObject({ type: 'paragraph', lines: [[{ text: 'We deliver in Lagos.' }], [{ text: 'Open Mon–Sat.' }]] });
    expect(blocks[2]).toMatchObject({ ordered: false, items: [[{ text: 'Lagos: 1–2 days' }], [{ text: 'Abuja: 3 days' }]] });
    expect(blocks[3]).toMatchObject({ ordered: true });
    expect(blocks[4]).toMatchObject({ level: 3 });
    const table = blocks[5];
    expect(table.type === 'table' && table.head.map(inlineText)).toEqual(['Size', 'Chest']);
    // a short row is padded rather than shifting columns
    expect(table.type === 'table' && table.rows.map((r) => r.map(inlineText))).toEqual([
      ['S', '90'],
      ['M', ''],
    ]);
  });

  it('gives repeated headings distinct anchors', () => {
    const ids = parsePageBody('## Returns\n\n## Returns\n\n## ?').flatMap((b) => (b.type === 'heading' ? [b.id] : []));
    expect(ids).toEqual(['returns', 'returns-2', 'section']);
  });

  it('handles Windows line endings and an empty page', () => {
    expect(parsePageBody('One\r\n\r\nTwo')).toHaveLength(2);
    expect(parsePageBody('')).toEqual([]);
    expect(parsePageBody('| --- |')).toEqual([]);
  });

  it('outlines the section headings only', () => {
    expect(pageOutline(parsePageBody('## A\n### a1\n## B'))).toEqual([
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ]);
  });
});

describe('pageExcerpt', () => {
  it('takes the opening words of the paragraphs, without formatting', () => {
    expect(pageExcerpt('## Hi\nWe are **Ada’s** shop.\n\n- list item')).toBe('We are Ada’s shop.');
    const long = pageExcerpt(`${'word '.repeat(80)}`, 50);
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('web addresses', () => {
  it('derives, validates and de-duplicates', () => {
    expect(pageSlugFrom('Shipping & Returns')).toBe('shipping-and-returns');
    expect(pageSlugFrom('???')).toBe('page');
    expect(isValidPageSlug('size-guide')).toBe(true);
    expect(isValidPageSlug('Size Guide')).toBe(false);
    expect(isValidPageSlug('-x')).toBe(false);
    expect(uniquePageSlug('faq', ['faq', 'faq-2'])).toBe('faq-3');
    expect(uniquePageSlug('about', ['faq'])).toBe('about');
  });
});

describe('where pages are linked', () => {
  const pages = [
    link('PRIVACY', 'Privacy policy', 'privacy'),
    link('CUSTOM', 'Wholesale', 'wholesale'),
    link('FAQ', 'FAQ', 'faq'),
    link('DELIVERY_RETURNS', 'Delivery and returns', 'delivery'),
    link('ABOUT', 'Our story', 'about'),
  ];

  it('files each page in its footer column, in a sensible order', () => {
    const { help, about } = footerPageLinks(pages);
    expect(help.map((l) => l.label)).toEqual(['Delivery and returns', 'FAQ']);
    expect(about.map((l) => l.label)).toEqual(['Our story', 'Privacy policy', 'Wholesale']);
  });

  it('offers checkout only the pages a shopper checks before paying', () => {
    expect(checkoutPageLinks(pages).map((p) => p.kind)).toEqual(['DELIVERY_RETURNS', 'PRIVACY']);
    expect(checkoutPageLinks([])).toEqual([]);
  });

  it('spots products that come in sizes', () => {
    expect(hasSizeOption(['Colour', 'Size'])).toBe(true);
    expect(hasSizeOption(['Shoe size'])).toBe(true);
    expect(hasSizeOption(['Colour', 'Storage'])).toBe(false);
  });
});
