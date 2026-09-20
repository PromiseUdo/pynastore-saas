/*
 * Deterministically generated product catalogue (~70 products) for the
 * dummy storefront. A seeded PRNG keeps every render/build identical, so
 * snapshot-style tests and SSR/CSR hydration stay stable.
 *
 * Shapes match `../types` exactly — a future Prisma-backed catalog can
 * return the same objects unchanged.
 */
import type {
  Product,
  ProductImage,
  ProductOption,
  ProductOptionValue,
  ProductTag,
  ProductVariant,
  ReviewSummary,
} from '../types';
import { CATEGORIES, CATEGORY_BY_SLUG, ancestorIds } from './categories';
import { BRANDS } from './brands';
import { img } from './images';

const CURRENCY = 'NGN';

/* ---- seeded PRNG (mulberry32) ---- */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const COLORS: ProductOptionValue[] = [
  { id: 'ov_col_black', label: 'Black', swatch: '#1a1a1a' },
  { id: 'ov_col_white', label: 'White', swatch: '#f4f4f5' },
  { id: 'ov_col_navy', label: 'Navy', swatch: '#1e293b' },
  { id: 'ov_col_sand', label: 'Sand', swatch: '#d8c3a5' },
  { id: 'ov_col_olive', label: 'Olive', swatch: '#5c6b3c' },
  { id: 'ov_col_rust', label: 'Rust', swatch: '#9c4a2f' },
  { id: 'ov_col_sky', label: 'Sky', swatch: '#7da7d9' },
  { id: 'ov_col_rose', label: 'Rose', swatch: '#d98a9e' },
];
const APPAREL_SIZES: ProductOptionValue[] = ['XS', 'S', 'M', 'L', 'XL'].map((s) => ({
  id: `ov_size_${s.toLowerCase()}`,
  label: s,
}));
const STORAGE: ProductOptionValue[] = ['128GB', '256GB', '512GB', '1TB'].map((s) => ({
  id: `ov_store_${s.toLowerCase()}`,
  label: s,
}));
/* EU sizing — shoes share the colour axis with apparel but never its sizes. */
const SHOE_SIZES: ProductOptionValue[] = ['38', '39', '40', '41', '42', '43', '44'].map((s) => ({
  id: `ov_shoe_${s}`,
  label: `EU ${s}`,
}));

type OptionProfile = 'apparel' | 'footwear' | 'colour' | 'storage-colour' | 'size-simple' | 'none';

interface Template {
  categorySlug: string;
  names: string[];
  profile: OptionProfile;
  price: [number, number]; // naira major units
}

const TEMPLATES: Template[] = [
  // Fashion
  { categorySlug: 'dresses', names: ['Wrap Midi Dress', 'Poplin Shirt Dress', 'Tiered Maxi Dress'], profile: 'apparel', price: [18000, 52000] },
  { categorySlug: 'tops', names: ['Silk-Blend Blouse', 'Ribbed Knit Top'], profile: 'apparel', price: [9000, 26000] },
  { categorySlug: 'skirts', names: ['Pleated Midi Skirt', 'Denim Mini Skirt', 'Bias-Cut Slip Skirt'], profile: 'apparel', price: [12000, 34000] },
  { categorySlug: 'outerwear', names: ['Belted Wool Coat', 'Quilted Puffer Jacket'], profile: 'apparel', price: [38000, 120000] },
  { categorySlug: 'activewear-w', names: ['Compression Leggings', 'Seamless Sports Bra'], profile: 'apparel', price: [8000, 22000] },
  { categorySlug: 'shirts', names: ['Oxford Button-Down', 'Linen Camp Shirt'], profile: 'apparel', price: [12000, 30000] },
  { categorySlug: 'tshirts', names: ['Heavyweight Cotton Tee', 'Piqué Polo'], profile: 'apparel', price: [6000, 16000] },
  { categorySlug: 'trousers', names: ['Tapered Chino', 'Pleated Wool Trouser'], profile: 'apparel', price: [14000, 38000] },
  { categorySlug: 'jackets', names: ['Waxed Field Jacket', 'Bomber Jacket'], profile: 'apparel', price: [30000, 90000] },
  { categorySlug: 'girls', names: ['Floral Play Dress', 'Fleece Zip Hoodie'], profile: 'apparel', price: [6000, 18000] },
  { categorySlug: 'boys', names: ['Ripstop Cargo Shorts', 'Graphic Sweatshirt'], profile: 'apparel', price: [6000, 18000] },
  { categorySlug: 'baby', names: ['Organic Bodysuit 3-Pack', 'Quilted Sleep Bag'], profile: 'size-simple', price: [7000, 20000] },
  { categorySlug: 'sneakers', names: ['Runner Low Sneaker', 'Court Leather Sneaker', 'Trail Running Shoe', 'Everyday Canvas Plimsoll'], profile: 'footwear', price: [22000, 96000] },
  { categorySlug: 'boots', names: ['Chelsea Leather Boot', 'Lace-Up Hiking Boot'], profile: 'footwear', price: [38000, 145000] },
  { categorySlug: 'sandals', names: ['Leather Slide Sandal', 'Woven Flat Sandal'], profile: 'footwear', price: [12000, 38000] },
  { categorySlug: 'bags', names: ['Structured Tote', 'Nylon Crossbody', 'Weekender Duffle'], profile: 'colour', price: [22000, 85000] },
  { categorySlug: 'watches', names: ['Automatic Field Watch', 'Minimalist Quartz Watch'], profile: 'colour', price: [45000, 180000] },
  { categorySlug: 'sunglasses', names: ['Acetate Square Sunglasses', 'Aviator Sunglasses'], profile: 'colour', price: [14000, 42000] },
  { categorySlug: 'jewellery', names: ['Gold Vermeil Hoops', 'Signet Ring'], profile: 'size-simple', price: [12000, 60000] },
  // Electronics
  { categorySlug: 'smartphones', names: ['Aura 5 Smartphone', 'Aura 5 Pro Smartphone'], profile: 'storage-colour', price: [280000, 720000] },
  { categorySlug: 'tablets', names: ['Slate 11 Tablet', 'Slate Mini Tablet'], profile: 'storage-colour', price: [180000, 460000] },
  { categorySlug: 'phone-cases', names: ['MagSafe Leather Case', 'Clear Impact Case'], profile: 'colour', price: [6000, 18000] },
  { categorySlug: 'laptops', names: ['Vellum 14 Laptop', 'Vellum 16 Studio Laptop'], profile: 'storage-colour', price: [650000, 1650000] },
  { categorySlug: 'monitors', names: ['27" 4K USB-C Monitor', '34" Ultrawide Monitor'], profile: 'none', price: [220000, 540000] },
  { categorySlug: 'keyboards-mice', names: ['Low-Profile Mechanical Keyboard', 'Ergo Wireless Mouse'], profile: 'colour', price: [28000, 78000] },
  { categorySlug: 'headphones', names: ['Orbit One Headphones', 'Orbit Studio Headphones'], profile: 'colour', price: [55000, 165000] },
  { categorySlug: 'earbuds', names: ['Orbit Air Earbuds', 'Orbit Air Pro Earbuds'], profile: 'colour', price: [32000, 95000] },
  { categorySlug: 'speakers', names: ['Portable Bluetooth Speaker', 'Bookshelf Speaker Pair'], profile: 'colour', price: [38000, 140000] },
  { categorySlug: 'mirrorless', names: ['Pixl M50 Camera Body', 'Pixl M50 + 24mm Kit'], profile: 'none', price: [420000, 980000] },
  { categorySlug: 'action-cams', names: ['Pixl Go Action Camera', 'Pixl Go Creator Bundle'], profile: 'none', price: [180000, 340000] },
  // Home
  { categorySlug: 'sofas', names: ['Kova 3-Seater Sofa', 'Kova Loveseat'], profile: 'colour', price: [320000, 780000] },
  { categorySlug: 'chairs', names: ['Oak Dining Chair', 'Lounge Accent Chair'], profile: 'colour', price: [45000, 190000] },
  { categorySlug: 'tables', names: ['Solid Oak Dining Table', 'Adjustable Standing Desk'], profile: 'none', price: [140000, 520000] },
  { categorySlug: 'storage', names: ['Modular Shelving Unit', 'Rattan Storage Bench'], profile: 'none', price: [55000, 210000] },
  { categorySlug: 'cookware', names: ['Tri-Ply Stainless Pan', 'Cast Iron Dutch Oven'], profile: 'size-simple', price: [22000, 96000] },
  { categorySlug: 'small-appliances', names: ['Pour-Over Coffee Maker', 'High-Speed Blender'], profile: 'none', price: [42000, 160000] },
  { categorySlug: 'tableware', names: ['Stoneware Dinner Set', 'Hand-Blown Glass Tumblers'], profile: 'none', price: [28000, 88000] },
  { categorySlug: 'lighting', names: ['Arc Floor Lamp', 'Linen Drum Pendant'], profile: 'colour', price: [35000, 140000] },
  { categorySlug: 'rugs', names: ['Hand-Knotted Wool Rug', 'Flatweave Runner'], profile: 'size-simple', price: [60000, 320000] },
  { categorySlug: 'wall-art', names: ['Framed Abstract Print', 'Gallery Print Set of 3'], profile: 'size-simple', price: [18000, 72000] },
  { categorySlug: 'duvets', names: ['Brushed Cotton Duvet Set', 'Linen Duvet Set'], profile: 'size-simple', price: [32000, 110000] },
  { categorySlug: 'pillows', names: ['Down-Alternative Pillow', 'Memory Foam Pillow'], profile: 'none', price: [12000, 34000] },
  // Beauty
  { categorySlug: 'cleansers', names: ['Gentle Gel Cleanser', 'Cream Balm Cleanser'], profile: 'none', price: [7000, 19000] },
  { categorySlug: 'serums', names: ['Vitamin C Brightening Serum', 'Hyaluronic Hydrating Serum'], profile: 'none', price: [12000, 32000] },
  { categorySlug: 'moisturisers', names: ['Barrier Repair Moisturiser', 'Oil-Free Gel Cream'], profile: 'none', price: [10000, 28000] },
  { categorySlug: 'suncare', names: ['Invisible SPF50 Fluid', 'Mineral SPF30 Lotion'], profile: 'none', price: [9000, 24000] },
  { categorySlug: 'face', names: ['Skin Tint SPF', 'Cream Blush Stick'], profile: 'size-simple', price: [8000, 22000] },
  { categorySlug: 'lips', names: ['Satin Lipstick', 'Tinted Lip Oil'], profile: 'size-simple', price: [6000, 16000] },
  { categorySlug: 'eyes', names: ['Volumising Mascara', 'Micro Brow Pencil'], profile: 'none', price: [6000, 15000] },
  { categorySlug: 'women-fragrance', names: ['Sable Neroli Eau de Parfum', 'Sable Fig & Cedar EDP'], profile: 'size-simple', price: [28000, 68000] },
  { categorySlug: 'men-fragrance', names: ['Sable Vetiver Eau de Parfum', 'Sable Amber Noir EDP'], profile: 'size-simple', price: [28000, 68000] },
  { categorySlug: 'shampoo', names: ['Strengthening Shampoo', 'Hydrating Conditioner'], profile: 'none', price: [7000, 18000] },
  { categorySlug: 'styling', names: ['Texturising Sea Salt Spray', 'Matte Styling Clay'], profile: 'none', price: [6000, 16000] },
  // Grocery
  { categorySlug: 'coffee', names: ['Single-Origin Whole Bean 1kg', 'Espresso Blend 500g'], profile: 'none', price: [8000, 16000] },
  { categorySlug: 'tea', names: ['Loose-Leaf Breakfast Tea', 'Peppermint Herbal Tea'], profile: 'none', price: [4000, 9000] },
  { categorySlug: 'juices', names: ['Cold-Pressed Green Juice 6-Pack', 'Orange & Turmeric Juice 6-Pack'], profile: 'none', price: [7000, 14000] },
  { categorySlug: 'chocolate', names: ['70% Dark Chocolate Bars 4-Pack', 'Sea Salt Caramel Bars 4-Pack'], profile: 'none', price: [5000, 11000] },
  { categorySlug: 'nuts', names: ['Roasted Almond & Cashew Mix', 'Trail Mix 800g'], profile: 'none', price: [5000, 12000] },
  { categorySlug: 'oils', names: ['Cold-Pressed Olive Oil 750ml', 'Aged Balsamic Vinegar 250ml'], profile: 'none', price: [6000, 15000] },
  { categorySlug: 'pasta-grains', names: ['Bronze-Cut Pasta 3-Pack', 'Stone-Ground Basmati 5kg'], profile: 'none', price: [4000, 12000] },
  // Toys & games
  { categorySlug: 'brick-sets', names: ['Coastal Village Brick Set', 'Orbital Station Brick Set'], profile: 'none', price: [14000, 68000] },
  { categorySlug: 'model-kits', names: ['Balsa Glider Model Kit', 'Die-Cast Rally Car Kit'], profile: 'none', price: [9000, 34000] },
  { categorySlug: 'board-games', names: ['Trade Routes Board Game', 'Cooperative Rescue Game'], profile: 'none', price: [12000, 38000] },
  { categorySlug: 'jigsaw-puzzles', names: ['1000-Piece Skyline Puzzle', '500-Piece Botanical Puzzle'], profile: 'size-simple', price: [5000, 14000] },
  { categorySlug: 'ride-ons', names: ['Folding Kick Scooter', 'Balance Bike'], profile: 'colour', price: [18000, 62000] },
  { categorySlug: 'water-play', names: ['Sand & Water Table', 'Splash Mat Play Set'], profile: 'none', price: [12000, 40000] },
  // Sports & outdoors
  { categorySlug: 'weights', names: ['Cast Iron Kettlebell', 'Adjustable Dumbbell Pair'], profile: 'size-simple', price: [18000, 145000] },
  { categorySlug: 'yoga', names: ['Cork Yoga Mat', 'Foam Recovery Roller'], profile: 'colour', price: [9000, 38000] },
  { categorySlug: 'tents', names: ['2-Person Trail Tent', '4-Person Dome Tent'], profile: 'none', price: [65000, 220000] },
  { categorySlug: 'sleeping-bags', names: ['Down Sleeping Bag −5°C', 'Synthetic Summer Bag'], profile: 'size-simple', price: [32000, 120000] },
  { categorySlug: 'helmets', names: ['Vented Road Helmet', 'MIPS Trail Helmet'], profile: 'colour', price: [28000, 95000] },
  { categorySlug: 'bike-accessories', names: ['USB Rechargeable Light Set', 'Frame Bag & Bottle Cage'], profile: 'colour', price: [8000, 32000] },
  // Jewelry & accessories
  { categorySlug: 'necklaces', names: ['Layered Chain Necklace', 'Pearl Drop Pendant'], profile: 'size-simple', price: [22000, 140000] },
  { categorySlug: 'rings', names: ['Eternity Moissanite Ring', 'Brushed Gold Band'], profile: 'size-simple', price: [35000, 260000] },
  { categorySlug: 'earrings', names: ['Huggie Hoop Earrings', 'Solitaire Stud Earrings'], profile: 'size-simple', price: [18000, 110000] },
  { categorySlug: 'bridal-sets', names: ['Gold Necklace & Earring Set', 'Heritage Bridal Set'], profile: 'size-simple', price: [95000, 480000] },
  { categorySlug: 'stacking-sets', names: ['Stacking Ring Trio', 'Mixed-Metal Bangle Set'], profile: 'size-simple', price: [16000, 72000] },
];

const HIGHLIGHTS_POOL = [
  'Free 30-day returns',
  'Ships in 24 hours',
  'Ethically sourced materials',
  '2-year manufacturer warranty',
  'Independently lab tested',
  'Designed to last',
  'Low-impact packaging',
];

function pick<T>(arr: T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)];
}
function pickN<T>(arr: T[], n: number, rnd: () => number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length) {
    out.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
  }
  return out;
}
function round100(n: number): number {
  return Math.round(n / 100) * 100;
}

function ratingSummary(rnd: () => number): ReviewSummary {
  const count = 4 + Math.floor(rnd() * 240);
  const avg = Math.round((3.4 + rnd() * 1.6) * 10) / 10;
  const dist: ReviewSummary['distribution'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (let i = 0; i < count; i++) {
    const r = Math.max(1, Math.min(5, Math.round(avg + (rnd() - 0.5) * 2))) as 1 | 2 | 3 | 4 | 5;
    dist[r]++;
  }
  return { average: avg, count, distribution: dist };
}

function optionsFor(profile: OptionProfile, rnd: () => number): ProductOption[] {
  switch (profile) {
    case 'apparel':
      return [
        { id: 'opt_color', name: 'Colour', kind: 'color', values: pickN(COLORS, 3 + Math.floor(rnd() * 3), rnd) },
        { id: 'opt_size', name: 'Size', kind: 'size', values: APPAREL_SIZES },
      ];
    case 'footwear':
      return [
        { id: 'opt_color', name: 'Colour', kind: 'color', values: pickN(COLORS, 3 + Math.floor(rnd() * 3), rnd) },
        { id: 'opt_size', name: 'Size', kind: 'size', values: SHOE_SIZES },
      ];
    case 'colour':
      return [{ id: 'opt_color', name: 'Colour', kind: 'color', values: pickN(COLORS, 3 + Math.floor(rnd() * 3), rnd) }];
    case 'storage-colour':
      return [
        { id: 'opt_storage', name: 'Storage', kind: 'select', values: pickN(STORAGE, 2 + Math.floor(rnd() * 2), rnd).sort() },
        { id: 'opt_color', name: 'Colour', kind: 'color', values: pickN(COLORS, 2 + Math.floor(rnd() * 2), rnd) },
      ];
    case 'size-simple':
      return [
        {
          id: 'opt_size',
          name: 'Size',
          kind: 'select',
          values: ['One size', 'Small', 'Medium', 'Large'].slice(0, 2 + Math.floor(rnd() * 3)).map((l) => ({
            id: `ov_ss_${l.toLowerCase().replace(/\s+/g, '-')}`,
            label: l,
          })),
        },
      ];
    case 'none':
      return [];
  }
}

function cartesian(lists: string[][]): string[][] {
  return lists.reduce<string[][]>(
    (acc, list) => acc.flatMap((prefix) => list.map((v) => [...prefix, v])),
    [[]],
  );
}

function buildProduct(template: Template, name: string, index: number): Product {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const id = `prod_${slug}`;
  const rnd = mulberry32(hashStr(id));
  const category = CATEGORY_BY_SLUG.get(template.categorySlug)!;
  const rootSlug = category.path[0];
  const brandPool = BRANDS.filter((b) => brandRoots[b.slug]?.includes(rootSlug)) ?? BRANDS;
  const brand = pick(brandPool.length ? brandPool : BRANDS, rnd);

  const options = optionsFor(template.profile, rnd);

  // images: 3–6, some tied to the first (colour) option's values
  const imageCount = 3 + Math.floor(rnd() * 4);
  const images: ProductImage[] = Array.from({ length: imageCount }, (_, i) => ({
    id: `${id}_img_${i}`,
    url: img(`${slug}-${i}`, 900, 1100),
    alt: `${name} — view ${i + 1}`,
  }));
  const colourOption = options.find((o) => o.kind === 'color');
  if (colourOption) {
    colourOption.values.forEach((val, i) => {
      const target = images[i % images.length];
      target.optionValueId = val.id;
    });
  }

  // pricing
  const [lo, hi] = template.price;
  const base = round100((lo + rnd() * (hi - lo)) * 100); // to kobo
  const onSale = rnd() < 0.4;
  const compareAt = onSale ? round100(base * (1.15 + rnd() * 0.35)) : null;

  // variants = cartesian product of option values
  const valueLists = options.map((o) => o.values.map((v) => v.id));
  const combos = options.length ? cartesian(valueLists) : [[]];
  const variants: ProductVariant[] = combos.map((optionValueIds, i) => {
    const delta = optionValueIds.some((v) => v.includes('512') || v.includes('1tb'))
      ? round100(base * 0.25)
      : optionValueIds.some((v) => v.includes('256'))
        ? round100(base * 0.12)
        : 0;
    const stock = rnd() < 0.12 ? 0 : 3 + Math.floor(rnd() * 60);
    const tiedImage = images.find((im) => optionValueIds.includes(im.optionValueId ?? ''));
    return {
      id: `${id}_v${i}`,
      sku: `${slug.slice(0, 6).toUpperCase()}-${String(i + 1).padStart(2, '0')}`,
      optionValueIds,
      price: base + delta,
      compareAtPrice: compareAt ? compareAt + delta : null,
      stock,
      imageId: tiedImage?.id ?? images[0].id,
    };
  });

  const prices = variants.map((v) => v.price);
  const priceFrom = Math.min(...prices);
  const priceTo = Math.max(...prices);
  const inStock = variants.some((v) => v.stock > 0);

  // tags
  const tags: ProductTag[] = [];
  if (index % 7 === 0) tags.push('new');
  if (onSale) tags.push('sale');
  if (rnd() < 0.25) tags.push('bestseller');
  if (rnd() < 0.2) tags.push('featured');
  if (rnd() < 0.12) tags.push('trending');

  const rating = ratingSummary(rnd);

  // Sales skew with reviews (people who bought are the people who rate), with
  // a long tail so some cards read "0 Sold" like a real new listing.
  const soldCount = Math.round(rating.count * (0.8 + rnd() * 3.5)) + (rnd() < 0.1 ? -rating.count : 0);

  const daysAgo = Math.floor(rnd() * 400);
  const createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString();

  return {
    id,
    slug,
    name,
    brandId: brand.id,
    brandName: brand.name,
    categoryId: category.id,
    categoryIds: [...ancestorIds(category.id), category.id],
    shortDescription: shortDescriptionFor(name, brand.name, rnd),
    description: descriptionFor(name, brand.name),
    highlights: pickN(HIGHLIGHTS_POOL, 3, rnd),
    specs: specsFor(template.categorySlug, rnd),
    images,
    options,
    variants,
    priceFrom,
    priceTo,
    compareAtPrice: compareAt,
    currency: CURRENCY,
    inStock,
    tags,
    rating,
    soldCount: Math.max(0, soldCount),
    createdAt,
    relatedIds: [],
  };
}

const brandRoots: Record<string, string[]> = {
  aeris: ['fashion'],
  northbound: ['fashion', 'sports-outdoors'],
  'maison-verte': ['home-living'],
  forge: ['home-living', 'fashion', 'sports-outdoors'],
  petal: ['beauty'],
  lumen: ['electronics'],
  orbit: ['electronics'],
  juniper: ['fashion', 'toys-games'],
  atlas: ['fashion', 'sports-outdoors', 'toys-games'],
  sable: ['beauty'],
  'harvest-lane': ['grocery'],
  kova: ['home-living', 'toys-games'],
  pixl: ['electronics'],
  solene: ['fashion', 'jewelry'],
};

function shortDescriptionFor(name: string, brand: string, rnd: () => number): string {
  const openers = [
    `${brand}'s take on the ${name.toLowerCase()}`,
    `A refined ${name.toLowerCase()} from ${brand}`,
    `The everyday ${name.toLowerCase()}, reworked by ${brand}`,
  ];
  const closers = [
    'built to be reached for again and again.',
    'with the details that matter and none that don’t.',
    'balancing comfort, durability and a clean silhouette.',
  ];
  return `${pick(openers, rnd)} — ${pick(closers, rnd)}`;
}

function descriptionFor(name: string, brand: string): string {
  return [
    `The ${name} by ${brand} is designed around how you actually use it. We start with materials chosen for longevity, then obsess over construction so it holds its shape and finish wear after wear.`,
    `Each piece is quality-checked before it ships and backed by our 30-day return policy. If it isn’t right, send it back — no questions.`,
    `**Care:** follow the label. Store away from direct sunlight. Spot clean where possible to extend its life.`,
  ].join('\n\n');
}

const FOOTWEAR_SLUGS = new Set(['sneakers', 'boots', 'sandals']);

function specsFor(categorySlug: string, rnd: () => number): { label: string; value: string }[] {
  const root = CATEGORY_BY_SLUG.get(categorySlug)?.path[0];
  if (FOOTWEAR_SLUGS.has(categorySlug)) {
    return [
      { label: 'Upper', value: pick(['Full-grain leather', 'Knit textile', 'Suede', 'Organic canvas'], rnd) },
      { label: 'Sole', value: pick(['Cupsole rubber', 'EVA foam', 'Vulcanised rubber', 'Commando lug'], rnd) },
      { label: 'Fit', value: pick(['True to size', 'Roomy', 'Narrow'], rnd) },
      { label: 'Care', value: 'Wipe clean, air dry away from heat' },
    ];
  }
  if (root === 'fashion') {
    return [
      { label: 'Composition', value: pick(['100% organic cotton', '80% wool / 20% polyamide', 'Recycled polyester', 'Linen / viscose blend'], rnd) },
      { label: 'Fit', value: pick(['Regular', 'Relaxed', 'Slim', 'Oversized'], rnd) },
      { label: 'Care', value: 'Machine wash cold, line dry' },
      { label: 'Origin', value: pick(['Portugal', 'Turkey', 'Italy', 'India'], rnd) },
    ];
  }
  if (root === 'electronics') {
    return [
      { label: 'Warranty', value: '24 months' },
      { label: 'Connectivity', value: pick(['Bluetooth 5.3', 'USB-C', 'Wi‑Fi 6E', 'NFC'], rnd) },
      { label: 'Battery', value: pick(['Up to 30h', 'Up to 18h', 'All-day', 'N/A'], rnd) },
      { label: 'In the box', value: 'Device, cable, quick-start guide' },
    ];
  }
  if (root === 'home-living') {
    return [
      { label: 'Material', value: pick(['Solid oak', 'Powder-coated steel', 'Stoneware', 'Wool'], rnd) },
      { label: 'Dimensions', value: `${40 + Math.floor(rnd() * 160)} × ${40 + Math.floor(rnd() * 90)} × ${30 + Math.floor(rnd() * 80)} cm` },
      { label: 'Assembly', value: pick(['Tool-free', 'Required (15 min)', 'None'], rnd) },
      { label: 'Care', value: 'Wipe with a damp cloth' },
    ];
  }
  if (root === 'beauty') {
    return [
      { label: 'Size', value: pick(['30 ml', '50 ml', '100 ml', '15 ml'], rnd) },
      { label: 'Skin type', value: pick(['All skin types', 'Dry / dehydrated', 'Combination / oily', 'Sensitive'], rnd) },
      { label: 'Formulation', value: 'Fragrance-free · non-comedogenic' },
      { label: 'Cruelty-free', value: 'Yes' },
    ];
  }
  return [
    { label: 'Net weight', value: pick(['250 g', '500 g', '1 kg', '6 × 250 ml'], rnd) },
    { label: 'Storage', value: 'Cool, dry place' },
    { label: 'Dietary', value: pick(['Vegan', 'Gluten-free', 'No added sugar', '—'], rnd) },
  ];
}

/* ---- build the catalogue ---- */
const built: Product[] = [];
TEMPLATES.forEach((tpl) => {
  tpl.names.forEach((name, i) => built.push(buildProduct(tpl, name, built.length + i)));
});

// wire relatedIds: same leaf category first, then same parent
for (const p of built) {
  const sameLeaf = built.filter((o) => o.id !== p.id && o.categoryId === p.categoryId);
  const sameParent = built.filter(
    (o) => o.id !== p.id && o.categoryId !== p.categoryId && o.categoryIds.includes(p.categoryIds[p.categoryIds.length - 2] ?? ''),
  );
  p.relatedIds = [...sameLeaf, ...sameParent].slice(0, 8).map((o) => o.id);
}

export const PRODUCTS: Product[] = built;
export const PRODUCT_BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));
export const PRODUCT_BY_SLUG = new Map(PRODUCTS.map((p) => [p.slug, p]));

// sanity: ensure every leaf category has at least one product
export const LEAF_CATEGORY_SLUGS = CATEGORIES.filter(
  (c) => !CATEGORIES.some((x) => x.parentId === c.id),
).map((c) => c.slug);
