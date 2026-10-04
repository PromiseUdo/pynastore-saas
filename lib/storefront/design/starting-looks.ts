/*
 * lib/storefront/design/starting-looks.ts
 *
 * Starting looks (ROADMAP 15.6): a look, a front page and a header that
 * suit a kind of shop, as a place to START — every part can be changed
 * afterwards. "Suggest a look" without AI: the business type a merchant
 * gave at sign-up picks the starting look we recommend.
 *
 * Pure. A starting look holds no words, pictures or products of its own:
 * only choices from the same fixed lists as the editor, and product bands
 * that name a SOURCE (best sellers, newest, a tag). A band whose source has
 * nothing in it isn't shown, so a starting look can't put an empty or
 * invented section on a shop. Headings on bands ("New arrivals") describe
 * the source, not the merchant.
 *
 * What a starting look never touches: the brand colour (kept if it suits
 * the new look), light or dark first, the footer, and the slides.
 */
import type { BusinessType } from '@/lib/onboarding/business';
import { classicSections, type HomepageSection } from '../sections/schema';
import type { HeaderLayout, StorefrontDesignConfig } from './schema';
import type { LookKey } from './looks';

import { STARTING_LOOK_IDS, type StartingLookId } from './starting-look-ids';
export { STARTING_LOOK_IDS, type StartingLookId };

export interface StartingLook {
  label: string;
  /** one line a merchant can choose by */
  description: string;
  look: LookKey;
  header: HeaderLayout;
  /** null = the Classic front page */
  sections: () => HomepageSection[] | null;
}

const band = (
  id: string,
  title: string,
  variant: 'carousel' | 'grid' | 'feature',
  source: Extract<HomepageSection, { type: 'products' }>['source'],
): HomepageSection => ({ id, type: 'products', enabled: true, variant, title, source });

export const STARTING_LOOKS: Record<StartingLookId, StartingLook> = {
  fashion: {
    label: 'Fashion and beauty',
    description: 'Elegant headings and big pictures. New arrivals first, then your categories.',
    look: 'editorial',
    header: 'centered',
    sections: () => [
      { id: 'hero', type: 'hero', enabled: true, variant: 'split' },
      band('new-arrivals', 'New arrivals', 'feature', { kind: 'newest' }),
      { id: 'categories', type: 'category-showcase', enabled: true, variant: 'tiles' },
      band('popular', 'Popular right now', 'carousel', { kind: 'bestselling' }),
      { id: 'for-you', type: 'recommended', enabled: true },
      { id: 'reviews', type: 'reviews', enabled: true },
      { id: 'recently-viewed', type: 'recently-viewed', enabled: true },
      { id: 'promises', type: 'service-features', enabled: true },
    ],
  },
  electronics: {
    label: 'Electronics and gadgets',
    description: 'Bold and to the point. Search up top, deals and best sellers first, brands near the top.',
    look: 'bold',
    header: 'search',
    sections: () => [
      { id: 'hero', type: 'hero', enabled: true, variant: 'full' },
      { id: 'deal', type: 'deal-of-the-day', enabled: true },
      band('best-sellers', 'Best sellers', 'grid', { kind: 'bestselling' }),
      { id: 'categories', type: 'category-showcase', enabled: true, variant: 'circles' },
      { id: 'brands', type: 'brands', enabled: true },
      band('new-arrivals', 'Just in', 'carousel', { kind: 'newest' }),
      { id: 'budget', type: 'price-explorer', enabled: true },
      { id: 'reviews', type: 'reviews', enabled: true },
      { id: 'promises', type: 'service-features', enabled: true },
    ],
  },
  grocery: {
    label: 'Groceries and everyday',
    description: 'Friendly and quick to shop. Search up top, departments first, then offers and favourites.',
    look: 'playful',
    header: 'search',
    sections: () => [
      { id: 'hero', type: 'hero', enabled: true, variant: 'full' },
      { id: 'categories', type: 'category-showcase', enabled: true, variant: 'circles' },
      { id: 'deal', type: 'deal-of-the-day', enabled: true },
      band('on-offer', 'On offer', 'carousel', { kind: 'tag', tag: 'sale' }),
      band('popular', 'Popular right now', 'grid', { kind: 'bestselling' }),
      { id: 'recently-viewed', type: 'recently-viewed', enabled: true },
      { id: 'missions', type: 'shopping-missions', enabled: true },
      { id: 'promises', type: 'service-features', enabled: true },
    ],
  },
  general: {
    label: 'Classic',
    description: 'The standard front page: warm, balanced, with search and guided browsing.',
    look: 'classic',
    header: 'standard',
    sections: () => null,
  },
};

const FOR_BUSINESS: Record<BusinessType, StartingLookId> = {
  fashion: 'fashion',
  beauty: 'fashion',
  electronics: 'electronics',
  groceries: 'grocery',
  health: 'grocery',
  home: 'general',
  books: 'general',
  other: 'general',
};

/** The starting look we suggest for what the merchant told us they sell. */
export function startingLookFor(businessType: string | null | undefined): StartingLookId {
  // Own keys only: `in` would also match inherited names like "__proto__".
  return businessType && Object.hasOwn(FOR_BUSINESS, businessType) ? FOR_BUSINESS[businessType as BusinessType] : 'general';
}

/**
 * A starting look applied over what the shop has: its look, front page and
 * header replace the current ones, Fine-tune is cleared (it belonged to the
 * old look), and the colour, light/dark and footer are kept. Whether the kept
 * colour suits the new look is the caller's to check.
 */
export function applyStartingLook(
  id: StartingLookId,
  current: StorefrontDesignConfig,
): StorefrontDesignConfig {
  const start = STARTING_LOOKS[id];
  return {
    ...current,
    look: start.look,
    corners: null,
    fonts: null,
    cards: null,
    header: { layout: start.header },
    sections: start.sections(),
    startingLook: id,
  };
}

/*
 * ─── Which starting look a design is on (so the editor can say so) ──────
 *
 * The parts a starting look decides: the look, Fine-tune (cleared), the
 * header and the front page. Colour, light/dark and footer are the shop's
 * own and never count.
 */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The parts a starting look decides, in a form that compares regardless of key order. */
function fingerprint(design: Pick<StorefrontDesignConfig, 'look' | 'corners' | 'fonts' | 'cards' | 'header' | 'sections'>) {
  return stable({
    look: design.look,
    corners: design.corners,
    fonts: design.fonts,
    cards: design.cards,
    header: design.header.layout,
    // "No arrangement" and the standard arrangement written out are the same page.
    sections: design.sections ?? classicSections(),
  });
}

export interface StartingLookStatus {
  id: StartingLookId;
  /** the look, header or front page has been changed since it was applied */
  changed: boolean;
}

/**
 * Which starting look this design is on, and whether it has been changed
 * since. A design that recorded where it started is compared with that; one
 * that didn't (made before starting looks, or never applied one) is matched
 * against all of them, and is only "on" one if it is exactly that — so the
 * standard Classic shop reads as Classic, and a shop arranged by hand reads
 * as its own design (null).
 */
export function startingLookStatus(design: StorefrontDesignConfig): StartingLookStatus | null {
  const mine = fingerprint(design);
  const recorded = design.startingLook;
  if (recorded) {
    return { id: recorded, changed: fingerprint(applyStartingLook(recorded, design)) !== mine };
  }
  for (const id of STARTING_LOOK_IDS) {
    if (fingerprint(applyStartingLook(id, design)) === mine) return { id, changed: false };
  }
  return null;
}
