// features/inventory/product-rules.ts
// Pure product rules shared by the server actions (which enforce them) and
// the product editor (which explains them as the user types). No Prisma, no
// 'use server'.
//
// One catalogue: an InventoryItem IS the online product. The storefront
// (lib/storefront/types.ts) needs a web address, images, per-variant prices
// and option kinds (colour swatches, sizes) — the shapes here are chosen so
// the catalog swap in Part 4 is a mapping, not a redesign.

import { slugify } from './category-tree';

export { slugify };

/* ─── Tags ──────────────────────────────────────────────────────────────── */

/** Mirrors `ProductTag` in lib/storefront/types.ts. */
export const PRODUCT_TAGS = [
  { value: 'new', label: 'New', hint: 'Shows a “New” badge' },
  { value: 'featured', label: 'Featured', hint: 'Eligible for homepage features' },
  { value: 'bestseller', label: 'Bestseller', hint: 'Appears in best-seller rails' },
  { value: 'sale', label: 'On sale', hint: 'Appears on the Sale page' },
  { value: 'trending', label: 'Trending', hint: 'Appears in trending rails' },
  { value: 'limited', label: 'Limited edition', hint: 'Shows a “Limited” badge' },
  { value: 'deal-of-day', label: 'Deal of the day', hint: 'Can be picked for the daily deal' },
] as const;

export type ProductTag = (typeof PRODUCT_TAGS)[number]['value'];

export function isProductTag(value: string): value is ProductTag {
  return PRODUCT_TAGS.some((t) => t.value === value);
}

/* ─── Variant options ───────────────────────────────────────────────────── */

export type OptionKind = 'color' | 'size' | 'select';

export type VariantOptionValue = { label: string; swatch?: string };
export type VariantOption = { name: string; kind: OptionKind; values: VariantOptionValue[] };

export const MAX_OPTIONS = 3;
export const MAX_VALUES_PER_OPTION = 30;
export const MAX_VARIANTS = 100;

const SWATCH_PATTERN = /^#[0-9a-f]{6}$/i;

/** A sensible kind from the option name, so "Colour" gets swatches without asking. */
export function guessOptionKind(name: string): OptionKind {
  const n = name.trim().toLowerCase();
  if (/^colou?rs?$|shade/.test(n)) return 'color';
  if (/^sizes?$|fit|length|waist/.test(n)) return 'size';
  return 'select';
}

/**
 * Reads `InventoryItem.variantOptions`, which older rows store as a plain
 * list of names (["Size","Color"]) with the values only on each variant.
 * Values are recovered from the variants in that case.
 */
export function normalizeVariantOptions(
  raw: unknown,
  variantAttributes: Record<string, string>[] = [],
): VariantOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): VariantOption | null => {
      if (typeof entry === 'string') {
        const values = [...new Set(variantAttributes.map((a) => a[entry]).filter(Boolean))];
        return { name: entry, kind: guessOptionKind(entry), values: values.map((label) => ({ label })) };
      }
      if (entry && typeof entry === 'object' && typeof (entry as VariantOption).name === 'string') {
        const e = entry as Partial<VariantOption>;
        const kind: OptionKind = e.kind === 'color' || e.kind === 'size' ? e.kind : 'select';
        const values = Array.isArray(e.values)
          ? e.values
              .filter((v): v is VariantOptionValue => Boolean(v && typeof v.label === 'string'))
              .map((v) => (v.swatch && SWATCH_PATTERN.test(v.swatch) ? { label: v.label, swatch: v.swatch } : { label: v.label }))
          : [];
        return { name: e.name!, kind, values };
      }
      return null;
    })
    .filter((o): o is VariantOption => o !== null);
}

/** Plain-language problem with the option set, or null. */
export function optionsProblem(options: VariantOption[]): string | null {
  if (options.length > MAX_OPTIONS) return `Use at most ${MAX_OPTIONS} options (e.g. Colour, Size, Material).`;
  const names = new Set<string>();
  for (const option of options) {
    const name = option.name.trim();
    if (!name) return 'Every option needs a name, like “Size”.';
    if (names.has(name.toLowerCase())) return `“${name}” is listed twice. Each option name must be different.`;
    names.add(name.toLowerCase());
    if (option.values.length === 0) return `Add at least one value for “${name}”.`;
    if (option.values.length > MAX_VALUES_PER_OPTION) return `“${name}” can have at most ${MAX_VALUES_PER_OPTION} values.`;
    const labels = new Set<string>();
    for (const value of option.values) {
      const label = value.label.trim();
      if (!label) return `One of the “${name}” values is empty.`;
      if (labels.has(label.toLowerCase())) return `“${label}” appears twice under “${name}”.`;
      labels.add(label.toLowerCase());
      if (value.swatch && !SWATCH_PATTERN.test(value.swatch)) return `The colour for “${label}” isn’t valid.`;
    }
  }
  return null;
}

/** Every combination of option values, in option order. */
export function variantCombinations(options: VariantOption[]): Record<string, string>[] {
  return options.reduce<Record<string, string>[]>(
    (combos, option) => combos.flatMap((combo) => option.values.map((v) => ({ ...combo, [option.name]: v.label }))),
    options.length ? [{}] : [],
  );
}

/** Stable identity for a combination, independent of object key order. */
export function combinationKey(attributes: Record<string, string>, options: VariantOption[]): string {
  return options.map((o) => `${o.name.toLowerCase()}=${(attributes[o.name] ?? '').toLowerCase()}`).join('|');
}

/** "Red / M" */
export function variantLabel(attributes: Record<string, string>, options: VariantOption[]): string {
  const ordered = options.length ? options.map((o) => attributes[o.name]) : Object.values(attributes);
  return ordered.filter(Boolean).join(' / ');
}

/** "TEE-001" + {Colour: Navy Blue, Size: XL} → "TEE-001-NAVYBLUE-XL" */
export function suggestVariantSku(parentSku: string, attributes: Record<string, string>, options: VariantOption[]): string {
  const parts = (options.length ? options.map((o) => attributes[o.name]) : Object.values(attributes))
    .filter(Boolean)
    .map((v) => v.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 10));
  return [parentSku.trim().toUpperCase(), ...parts].filter(Boolean).join('-').slice(0, 60);
}

/* ─── Pricing ───────────────────────────────────────────────────────────── */

export function compareAtProblem(price: number | null, compareAt: number | null): string | null {
  if (compareAt === null) return null;
  if (price === null) return 'Set a selling price before adding a “was” price.';
  if (compareAt <= price) return 'The “was” price must be higher than the selling price, or customers will see a fake discount.';
  return null;
}

/** Whole-number percentage off, or null when there's no real discount. */
export function discountPercent(price: number | null, compareAt: number | null): number | null {
  if (price === null || compareAt === null || compareAt <= price || compareAt <= 0) return null;
  return Math.round(((compareAt - price) / compareAt) * 100);
}

/* ─── Online readiness ──────────────────────────────────────────────────── */

export type ReadinessInput = {
  imageCount: number;
  /** effective prices of the sellable units (the product, or each active variant) */
  prices: (number | null)[];
  hasCategory: boolean;
  categoryVisible: boolean;
  hasDescription: boolean;
  onlineStoreCount: number;
  /** available units across stores that sell online; null = not known yet (new product) */
  onlineAvailable: number | null;
};

export type ReadinessCheck = {
  key: string;
  ok: boolean;
  /** blockers stop publishing; suggestions only warn */
  severity: 'blocker' | 'suggestion';
  label: string;
  hint: string;
};

export function productReadiness(input: ReadinessInput): ReadinessCheck[] {
  const priced = input.prices.length > 0 && input.prices.every((p) => p !== null && p > 0);
  return [
    {
      key: 'price',
      ok: priced,
      severity: 'blocker',
      label: 'Has a selling price',
      hint: input.prices.length > 1 ? 'Every variant needs a price (or set one for the whole product).' : 'Customers can’t buy it without a price.',
    },
    {
      key: 'image',
      ok: input.imageCount > 0,
      severity: 'blocker',
      label: 'Has at least one image',
      hint: 'Products without photos look broken in the store.',
    },
    {
      key: 'category',
      ok: input.hasCategory && input.categoryVisible,
      severity: 'suggestion',
      label: 'In a visible category',
      hint: input.hasCategory
        ? 'Its category is hidden from the online store, so customers can only find it by search.'
        : 'Without a category, customers can only find it by search.',
    },
    {
      key: 'description',
      ok: input.hasDescription,
      severity: 'suggestion',
      label: 'Has a description',
      hint: 'A short description helps customers decide and helps search.',
    },
    {
      key: 'stores',
      ok: input.onlineStoreCount > 0,
      severity: 'suggestion',
      label: 'A store sells online',
      hint: 'Choose which stores the website sells from on the Stores page, or it will show as out of stock.',
    },
    {
      key: 'stock',
      ok: input.onlineAvailable === null || input.onlineAvailable > 0,
      severity: 'suggestion',
      label: 'In stock online',
      hint: 'It will show as sold out until stock arrives at a store that sells online.',
    },
  ];
}

export function publishBlockers(checks: ReadinessCheck[]): ReadinessCheck[] {
  return checks.filter((c) => c.severity === 'blocker' && !c.ok);
}
