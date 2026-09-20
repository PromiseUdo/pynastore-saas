/*
 * Curated and dynamic collections for the dummy storefront.
 *
 * Collections cut ACROSS the category tree: "Travel Essentials" holds a
 * duffle (Fashion), earbuds (Electronics) and an SPF (Beauty). That is the
 * whole point of the concept — a category says what a product *is*, a
 * collection says why it is *here*.
 *
 * Curated lists hold product IDS ONLY. Nothing in this file duplicates a
 * product object, so a price, rating or stock change lands in one place.
 * Every id below is a real row in ./products.ts — `collections.test.ts`
 * fails the build if one ever stops resolving, which is what stops a
 * collection page quietly shrinking after a catalogue edit.
 *
 * Dynamic collections carry a rule instead of a list, so "New in" and
 * "Under ₦50,000" stay true as the catalogue changes rather than freezing a
 * snapshot. Both kinds resolve through the same `listProducts()` call.
 */
import type { Collection } from '../types';
import { img } from './images';

/** ₦ major units → kobo. Prices everywhere below this line are minor units. */
const naira = (major: number) => major * 100;

export const COLLECTIONS: Collection[] = [
  /* ─────────────────────────── dynamic ─────────────────────────── */
  {
    id: 'col_new-arrivals',
    slug: 'new-arrivals',
    name: 'New Arrivals',
    tagline: 'Just landed, across every department.',
    description:
      'The most recent additions to the store — updated as stock lands, never a hand-picked list that goes stale. Sorted newest first.',
    imageUrl: img('collection-new-arrivals', 800, 800),
    heroImageUrl: img('collection-new-arrivals-hero', 1600, 700),
    highlightTitle: 'Landed this week',
    sort: 'newest',
    featured: true,
    rule: { kind: 'dynamic', match: { createdWithinDays: 120 } },
  },
  {
    id: 'col_best-sellers',
    slug: 'best-sellers',
    name: 'Best Sellers',
    tagline: 'What everyone else is buying.',
    description:
      'Ranked by units actually sold in this store — not by what we would like to move. If it is here, it earned the spot.',
    imageUrl: img('collection-best-sellers', 800, 800),
    heroImageUrl: img('collection-best-sellers-hero', 1600, 700),
    highlightTitle: 'Top five right now',
    sort: 'bestselling',
    featured: true,
    rule: { kind: 'dynamic', match: { tag: 'bestseller' } },
  },
  {
    id: 'col_sale',
    slug: 'sale',
    name: 'On Sale',
    tagline: 'Everything currently reduced.',
    description:
      'Every product with a live price cut, in one place. Prices shown are the ones you pay — the struck-through figure is what it was.',
    imageUrl: img('collection-sale', 800, 800),
    heroImageUrl: img('collection-sale-hero', 1600, 700),
    highlightTitle: 'Biggest reductions',
    sort: 'bestselling',
    featured: true,
    rule: { kind: 'dynamic', match: { tag: 'sale' } },
  },
  {
    id: 'col_under-50k',
    slug: 'under-50k',
    name: 'Under ₦50,000',
    tagline: 'Good things, sensible money.',
    description:
      'Everything in the store that starts under ₦50,000 — a real price ceiling applied to the live catalogue, so nothing here will surprise you at checkout.',
    imageUrl: img('collection-under-50k', 800, 800),
    sort: 'bestselling',
    featured: true,
    rule: { kind: 'dynamic', match: { maxPrice: naira(50_000) } },
  },

  /* ─────────────────────────── curated ─────────────────────────── */
  {
    id: 'col_travel-essentials',
    slug: 'travel-essentials',
    name: 'Travel Essentials',
    tagline: 'Everything you need for your next trip.',
    description:
      'Packed by someone who travels light: one bag that takes a weekend, one that takes a laptop, and the small things you only miss once you are at the gate.',
    imageUrl: img('collection-travel', 800, 800),
    heroImageUrl: img('collection-travel-hero', 1600, 700),
    highlightTitle: 'Start with these',
    sort: 'bestselling',
    featured: true,
    rule: {
      kind: 'curated',
      productIds: [
        'prod_weekender-duffle',
        'prod_nylon-crossbody',
        'prod_orbit-air-earbuds',
        'prod_magsafe-leather-case',
        'prod_aviator-sunglasses',
        'prod_linen-camp-shirt',
        'prod_pixl-go-action-camera',
        'prod_invisible-spf50-fluid',
        'prod_foam-recovery-roller',
        'prod_peppermint-herbal-tea',
      ],
    },
  },
  {
    id: 'col_desk-setup',
    slug: 'desk-setup',
    name: 'The Desk Setup',
    tagline: 'Build a workspace you will actually sit at.',
    description:
      'Screen, input, seat, light, coffee. Each picked to work with the others rather than to win a spec sheet on its own.',
    imageUrl: img('collection-desk', 800, 800),
    heroImageUrl: img('collection-desk-hero', 1600, 700),
    highlightTitle: 'The core three',
    sort: 'bestselling',
    featured: true,
    rule: {
      kind: 'curated',
      productIds: [
        'prod_adjustable-standing-desk',
        'prod_vellum-14-laptop',
        'prod_27-4k-usb-c-monitor',
        'prod_low-profile-mechanical-keyboard',
        'prod_ergo-wireless-mouse',
        'prod_orbit-one-headphones',
        'prod_arc-floor-lamp',
        'prod_lounge-accent-chair',
        'prod_pour-over-coffee-maker',
      ],
    },
  },
  {
    id: 'col_gifts-for-her',
    slug: 'gifts-for-her',
    name: 'Gifts for Her',
    tagline: 'Thoughtful, not generic.',
    description:
      'A short list that covers most budgets — something small and lovely, something she would not buy herself, and something that will still be worn next year.',
    imageUrl: img('collection-gifts-her', 800, 800),
    heroImageUrl: img('collection-gifts-her-hero', 1600, 700),
    highlightTitle: 'Safest bets',
    sort: 'rating',
    featured: true,
    rule: {
      kind: 'curated',
      productIds: [
        'prod_layered-chain-necklace',
        'prod_solitaire-stud-earrings',
        'prod_sable-neroli-eau-de-parfum',
        'prod_silk-blend-blouse',
        'prod_gold-vermeil-hoops',
        'prod_structured-tote',
        'prod_cream-balm-cleanser',
        'prod_satin-lipstick',
        'prod_stacking-ring-trio',
        'prod_sea-salt-caramel-bars-4-pack',
      ],
    },
  },
  {
    id: 'col_staff-picks',
    slug: 'staff-picks',
    name: 'Staff Picks',
    tagline: 'The ten we keep recommending in person.',
    description:
      'Not the ten most profitable — the ten the people who pack your order own themselves. Spread across every department on purpose.',
    imageUrl: img('collection-staff-picks', 800, 800),
    highlightTitle: 'Most recommended',
    sort: 'rating',
    featured: true,
    rule: {
      kind: 'curated',
      productIds: [
        'prod_kova-3-seater-sofa',
        'prod_solitaire-stud-earrings',
        'prod_hand-knotted-wool-rug',
        'prod_high-speed-blender',
        'prod_micro-brow-pencil',
        'prod_roasted-almond-cashew-mix',
        'prod_34-ultrawide-monitor',
        'prod_4-person-dome-tent',
        'prod_cream-balm-cleanser',
        'prod_1000-piece-skyline-puzzle',
      ],
    },
  },
  {
    id: 'col_back-to-school',
    slug: 'back-to-school',
    name: 'Back to School',
    tagline: 'Kitted out for the term ahead.',
    description:
      'The list that actually gets used: something to carry it all, something to type on, layers for the walk there, and food for the walk back.',
    imageUrl: img('collection-back-to-school', 800, 800),
    heroImageUrl: img('collection-back-to-school-hero', 1600, 700),
    highlightTitle: 'The short list',
    sort: 'price-asc',
    featured: false,
    rule: {
      kind: 'curated',
      productIds: [
        'prod_nylon-crossbody',
        'prod_slate-mini-tablet',
        'prod_low-profile-mechanical-keyboard',
        'prod_fleece-zip-hoodie',
        'prod_graphic-sweatshirt',
        'prod_ripstop-cargo-shorts',
        'prod_heavyweight-cotton-tee',
        'prod_trail-mix-800g',
        'prod_500-piece-botanical-puzzle',
        'prod_folding-kick-scooter',
      ],
    },
  },
  {
    id: 'col_weekend-outdoors',
    slug: 'weekend-outdoors',
    name: 'Weekend Outdoors',
    tagline: 'Two days off, properly spent.',
    description:
      'Shelter, warmth, light and a way to remember it. Sized for a car boot and a Friday afternoon start.',
    imageUrl: img('collection-outdoors', 800, 800),
    heroImageUrl: img('collection-outdoors-hero', 1600, 700),
    highlightTitle: 'Pack these first',
    sort: 'bestselling',
    featured: false,
    rule: {
      kind: 'curated',
      productIds: [
        'prod_2-person-trail-tent',
        'prod_4-person-dome-tent',
        'prod_synthetic-summer-bag',
        'prod_down-sleeping-bag-5-c',
        'prod_mips-trail-helmet',
        'prod_usb-rechargeable-light-set',
        'prod_frame-bag-bottle-cage',
        'prod_pixl-go-action-camera',
        'prod_weekender-duffle',
      ],
    },
  },
  {
    id: 'col_home-refresh',
    slug: 'home-refresh',
    name: 'Home Refresh',
    tagline: 'Change the room without moving house.',
    description:
      'Textiles, light and surfaces — the four or five things that change how a room feels far more than the furniture does.',
    imageUrl: img('collection-home-refresh', 800, 800),
    heroImageUrl: img('collection-home-refresh-hero', 1600, 700),
    highlightTitle: 'Biggest difference, least effort',
    sort: 'bestselling',
    featured: false,
    rule: {
      kind: 'curated',
      productIds: [
        'prod_linen-duvet-set',
        'prod_stoneware-dinner-set',
        'prod_flatweave-runner',
        'prod_linen-drum-pendant',
        'prod_framed-abstract-print',
        'prod_hand-blown-glass-tumblers',
        'prod_modular-shelving-unit',
        'prod_memory-foam-pillow',
        'prod_arc-floor-lamp',
      ],
    },
  },
];

export const COLLECTION_BY_SLUG = new Map(COLLECTIONS.map((c) => [c.slug, c]));
export const COLLECTION_BY_ID = new Map(COLLECTIONS.map((c) => [c.id, c]));
