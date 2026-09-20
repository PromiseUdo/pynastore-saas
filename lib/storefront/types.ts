/*
 * lib/storefront/types.ts
 *
 * Domain model for the customer storefront. These shapes deliberately
 * mirror what a future Prisma-backed catalog would return so that swapping
 * `lib/storefront/catalog.ts` from fixtures to real queries is a drop-in
 * change, not a refactor of every component.
 *
 * Money is stored as an integer in the smallest currency unit (kobo for
 * NGN) — never floats — matching `lib/billing/paystack.ts`'s `toKobo`.
 */

export type Money = number; // minor units (kobo)

export type ProductTag =
  | 'new'
  | 'featured'
  | 'bestseller'
  | 'sale'
  | 'deal-of-day'
  | 'trending'
  | 'limited';

export interface Brand {
  id: string;
  slug: string;
  name: string;
  logoUrl: string;
  description: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  /** null for a root category */
  parentId: string | null;
  /** 0 = root, 1 = child, 2 = grandchild (max depth 3) */
  level: number;
  /** slug path from root, e.g. ['fashion', 'women', 'skirts'] */
  path: string[];
  description: string;
  imageUrl: string;
  /** merchandising: show in the header mega-menu */
  featured: boolean;
}

export interface CategoryNode extends Category {
  children: CategoryNode[];
  /** number of products in this node and all descendants */
  productCount: number;
}

export interface ProductImage {
  id: string;
  url: string;
  alt: string;
  /** optional: only set for images tied to a specific option value (e.g. a colour) */
  optionValueId?: string;
}

export interface ProductOptionValue {
  id: string;
  label: string;
  /** hex colour when the option is a colour swatch */
  swatch?: string;
}

export interface ProductOption {
  id: string;
  /** 'Color', 'Size', 'Material', ... */
  name: string;
  kind: 'color' | 'size' | 'select';
  values: ProductOptionValue[];
}

export interface ProductVariant {
  id: string;
  sku: string;
  /** one option-value id per product option, order matches product.options */
  optionValueIds: string[];
  price: Money;
  compareAtPrice: Money | null;
  stock: number;
  imageId: string | null;
}

export interface ReviewSummary {
  average: number; // 0..5, one decimal
  count: number;
  /** counts keyed by star (1..5) */
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  brandId: string;
  /** denormalised brand name (like priceFrom) — cards/cart read this directly */
  brandName: string;
  /** deepest category the product belongs to */
  categoryId: string;
  /** all category ids on the path (for listing/filtering) */
  categoryIds: string[];
  shortDescription: string;
  description: string; // may contain simple markdown
  highlights: string[];
  specs: { label: string; value: string }[];
  images: ProductImage[];
  options: ProductOption[];
  variants: ProductVariant[];
  /** denormalised from variants for fast listing */
  priceFrom: Money;
  priceTo: Money;
  compareAtPrice: Money | null;
  currency: string; // ISO 4217, e.g. 'NGN'
  inStock: boolean;
  tags: ProductTag[];
  rating: ReviewSummary;
  /** lifetime units sold — surfaced as social proof on cards ("8 Sold") */
  soldCount: number;
  createdAt: string; // ISO
  /** merchandising: related product ids (falls back to same-category) */
  relatedIds: string[];
}

export interface Review {
  id: string;
  productId: string;
  author: string;
  rating: 1 | 2 | 3 | 4 | 5;
  title: string;
  body: string;
  createdAt: string; // ISO
  verified: boolean;
  helpful: number;
}

export type SortKey =
  | 'relevance'
  | 'newest'
  | 'price-asc'
  | 'price-desc'
  | 'rating'
  | 'bestselling';

/**
 * Which store's catalogue a read applies to.
 *
 * The fixtures are a single global dataset, so today this is validated and
 * carried but not yet used to narrow anything. It exists now so no call site
 * has to change when `catalog.ts` moves onto Prisma and every query gains a
 * `where: { organizationId }` — the alternative is a storefront hardwired to
 * one merchant, which is exactly what this app is not.
 */
export interface StoreScope {
  /** the tenant's Organization.slug, as resolved by the storefront layout */
  organizationSlug: string;
}

export interface ListProductsParams {
  /** tenant seam — see StoreScope */
  store?: StoreScope;
  categoryPath?: string[];
  brandSlugs?: string[];
  minPrice?: Money;
  maxPrice?: Money;
  /** option value ids (colour/size/…) — OR within an option, AND across options */
  optionValueIds?: string[];
  /** spec values keyed by spec label — OR within a label, AND across labels */
  specs?: Record<string, string[]>;
  minRating?: number;
  inStockOnly?: boolean;
  tag?: ProductTag;
  /** every tag must be present (AND). `tag` is the single-tag shorthand. */
  tags?: ProductTag[];
  /**
   * Restrict the pool to these product ids, in no particular order — how a
   * CURATED collection is expressed. Everything else (query, filters, sort,
   * facets, paging) then applies on top, which is why a collection page is
   * the same engine and not a second one.
   */
  productIds?: string[];
  /** only products created within this many days — how a "new in" collection
   *  stays true over time instead of freezing a hand-picked list */
  createdWithinDays?: number;
  /**
   * Product ids in the order an EXTERNAL ranker put them — today the visual
   * search provider (lib/storefront/visual-search), tomorrow a vector index.
   * Used as the relevance ordering when there is no text query, so
   * `sort=relevance` means "closest visual match" on a visual result page
   * while every other sort behaves exactly as it does anywhere else.
   * Ignored when `query` is set: a typed query owns its own relevance.
   */
  relevanceOrder?: string[];
  query?: string;
  sort?: SortKey;
  page?: number;
  perPage?: number;
}

export interface FacetBucket {
  value: string;
  label: string;
  count: number;
  swatch?: string;
}

export interface ProductFacets {
  priceMin: Money;
  priceMax: Money;
  brands: FacetBucket[];
  /**
   * Both variant options AND product specs, in one list — which is what makes
   * the filter rail category-specific without a per-category config: laptops
   * offer Storage, Connectivity and Battery, shirts offer Colour, Size, Fit
   * and Composition, bags offer Material, because that is what those rows
   * actually carry. Nothing here is a hardcoded per-department filter set.
   */
  options: {
    name: string;
    kind: ProductOption['kind'];
    source: 'option' | 'spec';
    buckets: FacetBucket[];
  }[];
  ratings: FacetBucket[];
}

export interface ListProductsResult {
  items: Product[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  facets: ProductFacets;
  /** set only for text searches — see lib/storefront/search.ts */
  search?: {
    terms: string[];
    /** true when no product matched every term and the engine widened */
    partial: boolean;
  };
}

/* ---- option filter index ----
 *
 * Option values are identified internally by opaque ids (`ov_col_black`),
 * which make for unreadable, unshareable URLs. The index maps those ids to
 * stable human keys so a filtered search reads `?colour=black&size=m`.
 * Built from the catalogue, so a merchant whose options are Fabric/Voltage
 * gets `?fabric=…` with no code change. */
export interface OptionIndexValue {
  /** url key, e.g. 'black' */
  key: string;
  /** internal option-value id, e.g. 'ov_col_black' */
  id: string;
  label: string;
  swatch?: string;
}

export interface OptionIndexEntry {
  /** url key for the option itself, e.g. 'colour' */
  key: string;
  name: string;
  kind: ProductOption['kind'];
  /** 'option' = a variant option (buyable choice); 'spec' = a product attribute */
  source: 'option' | 'spec';
  values: OptionIndexValue[];
}

export type OptionIndex = OptionIndexEntry[];

/**
 * Spec filters (`?fit=slim&material=solid-oak`) ride the SAME index and the
 * same `optionValueIds` criteria list as variant options, with a synthetic id
 * of the form `spec:<label>:<value>`. One value space means the URL codec,
 * the chip model and the filter panel each stay a single implementation —
 * `criteriaToQuery` is the one place the two are told apart again.
 */
export const SPEC_VALUE_PREFIX = 'spec:';

/* ---- Product detail ---- */

/**
 * A customer question about a product.
 *
 * Answers carry a `source` because the plan is for an assistant to answer
 * these from the catalogue, reviews and policies — and a shopper is entitled
 * to know whether they are reading the merchant, another customer, or a
 * machine summarising both. The field exists now so that when the answer
 * stops being a fixture, the UI does not have to start lying or be rebuilt.
 */
export interface ProductAnswer {
  id: string;
  body: string;
  author: string;
  source: 'merchant' | 'customer' | 'assistant';
  createdAt: string; // ISO
}

export interface ProductQuestion {
  id: string;
  productId: string;
  body: string;
  author: string;
  createdAt: string; // ISO
  helpful: number;
  answers: ProductAnswer[];
}

/**
 * What the store promises about getting this product to the customer.
 *
 * Derived from the app's own shipping methods and thresholds (see
 * lib/storefront/pricing.ts) rather than written out as copy, so the PDP and
 * the cart can never quote different numbers. When a real rates API lands it
 * fills this same shape — with a destination — and the component is unchanged.
 */
export interface DeliveryPromise {
  options: {
    id: string;
    label: string;
    detail: string;
    /** the cheapest price for this zone or pickup point */
    price: Money;
    free: boolean;
    kind?: 'delivery' | 'pickup';
    /** the zone has several options, so `price` is a "from" price */
    fromPrice?: boolean;
    /** free delivery once the goods reach this */
    freeOver?: Money | null;
  }[];
  /** the merchant's own window (Settings → Delivery & returns); null = no returns offered */
  returnWindowDays: number | null;
  pickupAvailable: boolean;
  currency: string;
  /** the merchant's published "Delivery and returns" page, if they wrote one */
  policyPage: { title: string; href: string } | null;
}

/**
 * The recommendation sets a product page shows.
 *
 * Every set is produced by the same discovery service the search and
 * category pages use (see lib/storefront/product-detail.ts) — there is no
 * second product-matching implementation, and nothing here is a stored
 * "related products" list an editor has to maintain.
 */
export interface ProductRecommendations {
  similar: Product[];
  fromBrand: Product[];
  /** related, but cheaper — relevance first, then the closest lower prices */
  cheaper: Product[];
  /** related, more expensive AND better rated or better selling */
  premium: Product[];
  /** products this store's customers actually bought with this one (real
   *  orders/invoices, 2+ shared baskets); empty until there are sales */
  boughtTogether: Product[];
  /** companion products from genuinely different categories */
  completeTheLook: Product[];
  /** the label for the complete-the-look set, e.g. "Complete the setup" */
  completeTheLookTitle: string;
}

/* ---- Collections ---- */

/**
 * A collection answers "why are these together?", where a category answers
 * "what is this?". So a collection may span departments (Travel Essentials =
 * duffle + earbuds + sunglasses) and a product may sit in many at once.
 *
 * Two kinds, one page:
 *  - `curated`  — an editor's list of product ids. Never copies of products;
 *                 always references, so a price or stock change is reflected
 *                 everywhere at once.
 *  - `dynamic`  — a rule over product attributes ("under ₦50,000", "added in
 *                 the last 120 days"). Resolved through the same catalogue
 *                 query as everything else, so it can never drift out of date.
 *
 * The split exists now so that when the backend lands, `dynamic` rules become
 * a `where` clause and `curated` becomes a join table — with no page changes.
 */
export interface CollectionRule {
  kind: 'curated' | 'dynamic';
  /** curated: the members, in editorial order */
  productIds?: string[];
  /** dynamic: the attribute rule */
  match?: {
    categoryPath?: string[];
    tag?: ProductTag;
    minPrice?: Money;
    maxPrice?: Money;
    minRating?: number;
    createdWithinDays?: number;
  };
}

export interface Collection {
  id: string;
  slug: string;
  name: string;
  /** one line of editorial framing, shown under the title */
  tagline: string;
  description: string;
  /** square-ish card image for the collections index */
  imageUrl: string;
  /** wide image for the collection hero; omit for a text-only header */
  heroImageUrl?: string;
  /** heading for the short curated rail above the full grid */
  highlightTitle?: string;
  /** the order this collection reads best in */
  sort: SortKey;
  /** surfaced in navigation and on the collections index */
  featured: boolean;
  rule: CollectionRule;
}

/** A collection with its live product count attached. */
export interface CollectionSummary extends Collection {
  productCount: number;
  /** up to 3 real member images, for the index card */
  previewImages: string[];
}

/* ---- Merchandising / homepage ---- */

export interface HeroSlide {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaHref: string;
  imageUrl: string;
  align: 'left' | 'center' | 'right';
  theme: 'light' | 'dark';
}

export interface PromoBanner {
  id: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaHref: string;
  imageUrl: string;
  size: 'sm' | 'lg';
}

export interface Testimonial {
  id: string;
  author: string;
  role: string;
  avatarUrl: string;
  quote: string;
  rating: 1 | 2 | 3 | 4 | 5;
}

export interface BlogTeaser {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  imageUrl: string;
  date: string;
  category: string;
}

export interface HomepageSections {
  hero: HeroSlide[];
  serviceFeatures: { icon: string; title: string; description: string }[];
  featuredCategories: Category[];
  dealOfTheDay: { product: Product; endsAt: string } | null;
  collections: { key: string; title: string; subtitle: string; products: Product[] }[];
  /** the "Just for you" grid — a broad, cross-category spread rather than a
   *  merchandised collection, so the foot of the homepage always has depth */
  recommended: Product[];
  promoBanners: PromoBanner[];
  brands: Brand[];
  testimonials: Testimonial[];
  instagram: { id: string; imageUrl: string; href: string }[];
  blog: BlogTeaser[];
}

/* ---- Content pages ---- */

export type ContentBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'faq'; items: { q: string; a: string }[] }
  | { type: 'contact' };

/* ---- Cart / checkout / orders (client-side, mock) ---- */

export interface CartItem {
  productId: string;
  productSlug: string;
  variantId: string;
  name: string;
  brandName: string;
  imageUrl: string;
  optionSummary: string; // "Black · M"
  unitPrice: Money;
  compareAtPrice: Money | null;
  quantity: number;
  maxQuantity: number;
  currency: string;
  addedAt: number;
}

/**
 * A discount code the shopper has applied, as the storefront carries it.
 *
 * A snapshot of the merchant's record (`DiscountCode`) reduced to what the
 * money math needs — resolved on the server (lib/storefront/discounts/) and
 * re-resolved when the order is placed, because a browser holding this
 * object can edit it.
 */
export interface AppliedCoupon {
  code: string;
  /** what the shopper sees once it's on: "10% off your first order" */
  label: string;
  kind: 'percent' | 'fixed';
  value: number; // percent (0..100) or fixed minor units
  /** the goods must come to at least this much; null = no minimum */
  minSubtotal?: Money | null;
}

export interface Address {
  id: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  country: string;
  postalCode?: string;
  isDefault?: boolean;
}

export interface ShippingMethod {
  id: string;
  label: string;
  description: string;
  /** what the shopper pays for it on this order (0 once a free-over threshold is met) */
  price: Money;
  etaDays: [number, number];
  /** 'pickup' means nothing is delivered; absent on the demo fixtures */
  kind?: 'delivery' | 'pickup';
  /** the price before any free-delivery threshold */
  regularPrice?: Money;
  /** delivery is free once the goods reach this; null = never */
  freeOver?: Money | null;
  /** pickup options: where to collect from */
  pickup?: { name: string; address: string; city: string; state: string; instructions: string | null };
}

export interface OrderTotals {
  subtotal: Money;
  discount: Money;
  shipping: Money;
  /** no delivery option chosen yet: `shipping` is 0 and `total` excludes delivery */
  shippingPending?: boolean;
  tax: Money;
  total: Money;
  currency: string;
}

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export interface Order {
  reference: string;
  createdAt: string;
  status: OrderStatus;
  email: string;
  items: CartItem[];
  shippingAddress: Address;
  shippingMethod: ShippingMethod;
  coupon: AppliedCoupon | null;
  totals: OrderTotals;
  timeline: { status: OrderStatus; label: string; at: string | null }[];
}

export interface Customer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  createdAt: string;
}
