// Editor state for the product form, and the pure functions that move it
// to and from the server shapes. Kept free of React so it can be tested.

import type { ItemStatus } from '@/lib/generated/prisma/enums';
import type { ProductDetail, ProductInput } from '@/features/inventory/actions';
import {
  MAX_VARIANTS,
  compareAtProblem,
  optionsProblem,
  suggestVariantSku,
  type OptionKind,
  type VariantOption,
} from '@/features/inventory/product-rules';
import { SLUG_PATTERN, slugify } from '@/features/inventory/category-tree';
import type { UploadedImage } from '@/components/media/image-uploader';

export type OptionDraft = { key: string; name: string; kind: OptionKind; values: { key: string; label: string; swatch?: string }[] };

export type VariantDraft = {
  id?: string;
  /** sorted option-value keys — survives renaming an option or a value */
  key: string;
  valueKeys: string[];
  attributes: Record<string, string>;
  /** false = this combination isn't sold (removed on save) */
  enabled: boolean;
  sku: string;
  skuTouched: boolean;
  barcode: string;
  sellingPrice: string;
  compareAtPrice: string;
  imageUrl: string | null;
  available?: number;
};

export type FormState = {
  name: string;
  sku: string;
  barcode: string;
  unit: string;
  description: string;
  shortDescription: string;
  categoryId: string | null;
  brandId: string | null;
  preferredSupplierId: string | null;
  reorderPoint: string;
  sellingPrice: string;
  compareAtPrice: string;
  status: ItemStatus;
  isPublished: boolean;
  /** true = customers must pay before delivery; pay on delivery isn't offered */
  requiresPrepayment: boolean;
  slug: string;
  slugTouched: boolean;
  tags: string[];
  highlights: string[];
  specs: { label: string; value: string }[];
  images: UploadedImage[];
  hasVariants: boolean;
  options: OptionDraft[];
  variants: VariantDraft[];
};

let seq = 0;
export const newKey = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;

const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

export function emptyFormState(): FormState {
  return {
    name: '',
    sku: '',
    barcode: '',
    unit: 'pcs',
    description: '',
    shortDescription: '',
    categoryId: null,
    brandId: null,
    preferredSupplierId: null,
    reorderPoint: '',
    sellingPrice: '',
    compareAtPrice: '',
    status: 'ACTIVE',
    isPublished: false,
    requiresPrepayment: false,
    slug: '',
    slugTouched: false,
    tags: [],
    highlights: [],
    specs: [],
    images: [],
    hasVariants: false,
    options: [],
    variants: [],
  };
}

export function toOptionsPlain(options: OptionDraft[]): VariantOption[] {
  return options.map((o) => ({
    name: o.name.trim(),
    kind: o.kind,
    values: o.values.map((v) => (v.swatch && o.kind === 'color' ? { label: v.label.trim(), swatch: v.swatch } : { label: v.label.trim() })),
  }));
}

export function formStateFromProduct(p: ProductDetail): FormState {
  const options: OptionDraft[] = p.options.map((o) => ({
    key: newKey(),
    name: o.name,
    kind: o.kind,
    values: o.values.map((v) => ({ key: newKey(), ...v })),
  }));
  const active = p.variants.filter((v) => v.status !== 'ARCHIVED');
  const drafts: VariantDraft[] = active.map((v) => {
    const valueKeys = options.map((o) => o.values.find((val) => val.label === v.attributes[o.name])?.key ?? '');
    return {
    id: v.id,
    key: comboKey(valueKeys),
    valueKeys,
    attributes: v.attributes,
    enabled: true,
    sku: v.sku,
    skuTouched: true,
    barcode: v.barcode ?? '',
    sellingPrice: str(v.sellingPrice),
    compareAtPrice: str(v.compareAtPrice),
    imageUrl: v.imageUrl,
    available: v.available,
    };
  });
  return {
    name: p.name,
    sku: p.sku,
    barcode: p.barcode ?? '',
    unit: p.unit,
    description: p.description ?? '',
    shortDescription: p.shortDescription ?? '',
    categoryId: p.categoryId,
    brandId: p.brandId,
    preferredSupplierId: p.preferredSupplierId,
    reorderPoint: str(p.reorderPoint),
    sellingPrice: str(p.sellingPrice),
    compareAtPrice: str(p.compareAtPrice),
    status: p.status,
    isPublished: p.isPublished,
    requiresPrepayment: p.requiresPrepayment,
    slug: p.slug ?? '',
    slugTouched: Boolean(p.slug),
    tags: p.tags,
    highlights: p.highlights,
    specs: p.specs,
    images: p.images.map(({ id: _id, ...i }) => i),
    hasVariants: active.length > 0,
    options,
    variants: syncVariants(options, drafts, p.sku, { enableNew: false }),
  };
}

const comboKey = (valueKeys: string[]) => [...valueKeys].sort().join('|');

/**
 * Rebuilds the variant rows for the current options: every combination gets
 * a row, existing rows (by combination) keep what the user typed, and new
 * combinations are switched on with a suggested SKU.
 */
export function syncVariants(
  options: OptionDraft[],
  current: VariantDraft[],
  parentSku: string,
  { enableNew = true }: { enableNew?: boolean } = {},
): VariantDraft[] {
  const usable = options
    .map((o) => ({ ...o, name: o.name.trim(), values: o.values.filter((v) => v.label.trim()) }))
    .filter((o) => o.name && o.values.length);
  if (usable.length === 0) return [];
  const plain = toOptionsPlain(usable);

  // Cartesian product over value keys.
  const combos = usable
    .reduce<{ key: string; label: string }[][]>(
      (acc, o) => acc.flatMap((combo) => o.values.map((v) => [...combo, { key: v.key, label: v.label.trim() }])),
      [[]],
    )
    .slice(0, MAX_VARIANTS);

  const byKey = new Map(current.map((v) => [v.key, v]));
  return combos.map((combo) => {
    const valueKeys = combo.map((c) => c.key);
    const key = comboKey(valueKeys);
    const attributes = Object.fromEntries(usable.map((o, i) => [o.name, combo[i].label]));
    const existing = byKey.get(key);
    if (existing) {
      return { ...existing, valueKeys, attributes, sku: existing.skuTouched ? existing.sku : suggestVariantSku(parentSku, attributes, plain) };
    }
    return {
      key,
      valueKeys,
      attributes,
      enabled: enableNew,
      sku: suggestVariantSku(parentSku, attributes, plain),
      skuTouched: false,
      barcode: '',
      sellingPrice: '',
      compareAtPrice: '',
      imageUrl: null,
    };
  });
}

export function variantComboCount(options: OptionDraft[]): number {
  return options.reduce((n, o) => n * Math.max(1, o.values.filter((v) => v.label.trim()).length), options.length ? 1 : 0);
}

/* ─── Validation ────────────────────────────────────────────────────────── */

export type FieldErrors = Record<string, string>;

function parseMoney(value: string): number | null | 'invalid' {
  const trimmed = value.replace(/,/g, '').trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : 'invalid';
}

export function validateForm(state: FormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!state.name.trim()) errors.name = 'Give the product a name.';
  if (!state.sku.trim()) errors.sku = 'Add a SKU — the code you use to identify this product.';

  const price = parseMoney(state.sellingPrice);
  const was = parseMoney(state.compareAtPrice);
  if (price === 'invalid') errors.sellingPrice = 'Enter a price like 5000 or 4999.99.';
  if (was === 'invalid') errors.compareAtPrice = 'Enter a price like 7500.';
  if (price !== 'invalid' && was !== 'invalid' && !state.hasVariants) {
    const problem = compareAtProblem(price, was);
    if (problem) errors.compareAtPrice = problem;
  }

  const reorder = parseMoney(state.reorderPoint);
  if (reorder === 'invalid') errors.reorderPoint = 'Enter a whole number, like 10.';

  const slug = effectiveSlug(state);
  if (slug && !SLUG_PATTERN.test(slug)) errors.slug = 'Use lowercase letters, numbers and single hyphens only.';

  if (state.shortDescription.length > 200) errors.shortDescription = 'Keep it under 200 characters.';
  if (state.highlights.some((h) => !h.trim())) errors.highlights = 'Fill in or remove the empty highlight.';
  if (state.specs.some((s) => !s.label.trim() || !s.value.trim())) errors.specs = 'Every specification needs a name and a value.';

  if (state.hasVariants) {
    const problem = optionsProblem(toOptionsPlain(state.options));
    if (problem) errors.options = problem;
    else if (variantComboCount(state.options) > MAX_VARIANTS) errors.options = `That makes more than ${MAX_VARIANTS} variants. Remove some values.`;
    const enabled = state.variants.filter((v) => v.enabled);
    if (!problem && enabled.length === 0) errors.variants = 'Switch on at least one variant.';
    const skus = new Set<string>([state.sku.trim().toLowerCase()]);
    for (const v of enabled) {
      const label = Object.values(v.attributes).join(' / ');
      if (!v.sku.trim()) {
        errors.variants = `${label} needs a SKU.`;
        break;
      }
      if (skus.has(v.sku.trim().toLowerCase())) {
        errors.variants = `The SKU “${v.sku.trim()}” is used more than once.`;
        break;
      }
      skus.add(v.sku.trim().toLowerCase());
      const vp = parseMoney(v.sellingPrice);
      const vw = parseMoney(v.compareAtPrice);
      if (vp === 'invalid' || vw === 'invalid') {
        errors.variants = `${label} has a price that isn’t a number.`;
        break;
      }
      const effective = vp ?? (price === 'invalid' ? null : price);
      const problem2 = compareAtProblem(effective, vw);
      if (problem2) {
        errors.variants = `${label}: ${problem2}`;
        break;
      }
    }
  }
  return errors;
}

export function effectiveSlug(state: FormState): string {
  if (state.slugTouched) return state.slug.trim();
  return state.name.trim() ? slugify(state.name) : '';
}

/** Prices each sellable unit would actually sell at — for the readiness checklist. */
export function effectivePrices(state: FormState): (number | null)[] {
  const base = parseMoney(state.sellingPrice);
  const baseNum = base === 'invalid' ? null : base;
  if (!state.hasVariants) return [baseNum];
  return state.variants
    .filter((v) => v.enabled)
    .map((v) => {
      const p = parseMoney(v.sellingPrice);
      return p === 'invalid' ? null : (p ?? baseNum);
    });
}

export function toProductInput(state: FormState): ProductInput {
  const money = (v: string) => {
    const p = parseMoney(v);
    return p === 'invalid' ? null : p;
  };
  const options = state.hasVariants ? toOptionsPlain(state.options) : [];
  return {
    name: state.name.trim(),
    sku: state.sku.trim(),
    barcode: state.hasVariants ? null : state.barcode.trim() || null,
    unit: state.unit.trim() || 'pcs',
    description: state.description.trim() || null,
    shortDescription: state.shortDescription.trim() || null,
    categoryId: state.categoryId,
    brandId: state.brandId,
    preferredSupplierId: state.preferredSupplierId,
    reorderPoint: money(state.reorderPoint),
    sellingPrice: money(state.sellingPrice),
    compareAtPrice: state.hasVariants ? null : money(state.compareAtPrice),
    status: state.status,
    isPublished: state.isPublished,
    requiresPrepayment: state.requiresPrepayment,
    slug: state.slugTouched ? state.slug.trim() : '',
    tags: state.tags,
    highlights: state.highlights.map((h) => h.trim()).filter(Boolean),
    specs: state.specs.filter((s) => s.label.trim() && s.value.trim()),
    images: state.images.map((i) => ({ url: i.url, publicId: i.publicId, alt: i.alt?.trim() || undefined, width: i.width, height: i.height })),
    options,
    variants: state.hasVariants
      ? state.variants
          .filter((v) => v.enabled)
          .map((v) => ({
            id: v.id,
            sku: v.sku.trim(),
            barcode: v.barcode.trim() || null,
            attributes: v.attributes,
            sellingPrice: money(v.sellingPrice),
            compareAtPrice: money(v.compareAtPrice),
            imageUrl: v.imageUrl && state.images.some((i) => i.url === v.imageUrl) ? v.imageUrl : null,
          }))
      : [],
  };
}
