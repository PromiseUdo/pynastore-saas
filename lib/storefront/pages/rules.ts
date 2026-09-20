/*
 * lib/storefront/pages/rules.ts
 *
 * The merchant's store pages: what kinds there are, where the storefront
 * links each one, and what a web address may look like. Pure — the admin
 * editor, the server actions and the storefront all read these rules, so
 * "where does the privacy page get linked" has one answer.
 *
 * A kind decides WHERE a page is linked, never what it says. The app writes
 * no page text: there are hints about what a merchant usually covers, and
 * nothing more. A policy page is the store's own promise in its own name,
 * and generated copy is how a store ends up promising free returns that
 * nothing enforces (see the note at the bottom of ../catalog.ts).
 */
import { slugify as slugifyName, SLUG_PATTERN } from '@/features/inventory/category-tree';

export const STORE_PAGE_KINDS = [
  'ABOUT',
  'DELIVERY_RETURNS',
  'FAQ',
  'SIZE_GUIDE',
  'CONTACT',
  'TERMS',
  'PRIVACY',
  'CUSTOM',
] as const;

export type StorePageKind = (typeof STORE_PAGE_KINDS)[number];

/** The two footer columns a page can sit in. */
export type FooterGroup = 'help' | 'about';

export interface StorePageKindInfo {
  /** what the admin calls it, and the title a new page starts with */
  label: string;
  /** the web address a new page of this kind is offered */
  slug: string;
  footer: FooterGroup;
  /** one line for the admin: what this page is for */
  purpose: string;
  /** what merchants usually cover — shown as guidance, never inserted */
  covers: string[];
}

export const STORE_PAGE_KIND_INFO: Record<StorePageKind, StorePageKindInfo> = {
  ABOUT: {
    label: 'About us',
    slug: 'about',
    footer: 'about',
    purpose: 'Who you are and what your store sells.',
    covers: ['How the business started', 'What you sell and who for', 'Where you are based'],
  },
  DELIVERY_RETURNS: {
    label: 'Delivery and returns',
    slug: 'delivery-and-returns',
    footer: 'help',
    purpose: 'How orders reach customers, and what happens if something goes back.',
    covers: [
      'Where you deliver and roughly how long it takes',
      'How customers ask for a return, and what condition items must be in',
      'How and when refunds are paid',
    ],
  },
  FAQ: {
    label: 'Frequently asked questions',
    slug: 'faq',
    footer: 'help',
    purpose: 'Answers to the questions customers ask you most.',
    covers: ['Write each question as a heading (## ) with the answer underneath'],
  },
  SIZE_GUIDE: {
    label: 'Size guide',
    slug: 'size-guide',
    footer: 'help',
    purpose: 'How your sizes measure up. Linked from products that come in sizes.',
    covers: ['A table of your sizes and their measurements', 'How to measure yourself'],
  },
  CONTACT: {
    label: 'Contact us',
    slug: 'contact',
    footer: 'help',
    purpose: 'How customers can reach you.',
    covers: ['Phone, WhatsApp or email', 'Opening hours', 'Your shop address, if customers can visit'],
  },
  TERMS: {
    label: 'Terms and conditions',
    slug: 'terms',
    footer: 'about',
    purpose: 'The terms customers agree to when they buy from you.',
    covers: ['Orders and pricing', 'Payment', 'Delivery, returns and refunds', 'Your responsibilities and theirs'],
  },
  PRIVACY: {
    label: 'Privacy policy',
    slug: 'privacy',
    footer: 'about',
    purpose: 'What you do with customers’ personal information. Linked from the cookie notice.',
    covers: [
      'What information you collect and why',
      'Who you share it with (for example, delivery and payment companies)',
      'How customers can ask to see or delete it',
    ],
  },
  CUSTOM: {
    label: 'Other page',
    slug: 'page',
    footer: 'about',
    purpose: 'Anything else you want customers to be able to read.',
    covers: [],
  },
};

/** Kinds a store can have one of. CUSTOM pages are unlimited. */
export const SINGLE_KINDS = STORE_PAGE_KINDS.filter((kind) => kind !== 'CUSTOM');

export function isStorePageKind(value: unknown): value is StorePageKind {
  return typeof value === 'string' && (STORE_PAGE_KINDS as readonly string[]).includes(value);
}

/* ---------------- web addresses ---------------- */

export const PAGE_SLUG_MAX = 60;

/** "Our story & values" → "our-story-and-values"; nothing usable → "page". */
export function pageSlugFrom(title: string): string {
  return /[a-z0-9]/i.test(title) ? slugifyName(title) : 'page';
}

export function isValidPageSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= PAGE_SLUG_MAX && SLUG_PATTERN.test(slug);
}

/** `base`, or `base-2`, `base-3`… — the first one not in `taken`. */
export function uniquePageSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, PAGE_SLUG_MAX - String(n).length - 1)}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Where the storefront serves a page. */
export function storePageHref(slug: string): string {
  return `/pages/${slug}`;
}

/* ---------------- what the storefront links ---------------- */

/** A published page, as the storefront's links need it. */
export interface StorePageLink {
  kind: StorePageKind;
  title: string;
  slug: string;
  href: string;
}

export interface FooterPageLinks {
  help: { label: string; href: string }[];
  about: { label: string; href: string }[];
}

/* The order pages appear in within a footer column: the ones a shopper most
 * often goes looking for first. Custom pages follow, alphabetically. */
const FOOTER_ORDER: StorePageKind[] = [
  'DELIVERY_RETURNS',
  'SIZE_GUIDE',
  'FAQ',
  'CONTACT',
  'ABOUT',
  'TERMS',
  'PRIVACY',
  'CUSTOM',
];

export function footerPageLinks(pages: StorePageLink[]): FooterPageLinks {
  const sorted = [...pages].sort(
    (a, b) => FOOTER_ORDER.indexOf(a.kind) - FOOTER_ORDER.indexOf(b.kind) || a.title.localeCompare(b.title),
  );
  const out: FooterPageLinks = { help: [], about: [] };
  for (const page of sorted) {
    out[STORE_PAGE_KIND_INFO[page.kind].footer].push({ label: page.title, href: page.href });
  }
  return out;
}

/** The first published page of a kind, or null — "is there a privacy page to link to?". */
export function pageOfKind(pages: StorePageLink[], kind: Exclude<StorePageKind, 'CUSTOM'>): StorePageLink | null {
  return pages.find((page) => page.kind === kind) ?? null;
}

/**
 * The pages a shopper may want to check before paying, in the order the
 * checkout footer lists them. Only those the merchant has published.
 */
export function checkoutPageLinks(pages: StorePageLink[]): StorePageLink[] {
  const kinds: StorePageKind[] = ['DELIVERY_RETURNS', 'TERMS', 'PRIVACY', 'CONTACT'];
  return kinds.map((kind) => pages.find((page) => page.kind === kind)).filter((p): p is StorePageLink => !!p);
}

/** Option names that mean "this product comes in sizes", so a size guide is worth linking. */
export function hasSizeOption(optionNames: string[]): boolean {
  return optionNames.some((name) => /\bsize\b/i.test(name));
}
