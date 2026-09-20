import { describe, expect, it } from 'vitest';
import {
  effectivePrices,
  emptyFormState,
  formStateFromProduct,
  syncVariants,
  toProductInput,
  validateForm,
  type OptionDraft,
} from './product-form-state';
import type { ProductDetail } from '@/features/inventory/actions';

const colour: OptionDraft = {
  key: 'o1',
  name: 'Colour',
  kind: 'color',
  values: [
    { key: 'red', label: 'Red', swatch: '#cc0000' },
    { key: 'navy', label: 'Navy' },
  ],
};
const size: OptionDraft = { key: 'o2', name: 'Size', kind: 'size', values: [{ key: 'm', label: 'M' }] };

describe('syncVariants', () => {
  it('creates a row per combination with suggested SKUs', () => {
    const rows = syncVariants([colour, size], [], 'TEE');
    expect(rows.map((r) => r.sku)).toEqual(['TEE-RED-M', 'TEE-NAVY-M']);
    expect(rows.every((r) => r.enabled)).toBe(true);
  });

  it('keeps typed prices when an option or value is renamed', () => {
    const rows = syncVariants([colour, size], [], 'TEE');
    rows[0].sellingPrice = '9000';
    const renamed = syncVariants(
      [{ ...colour, name: 'Color', values: [{ key: 'red', label: 'Crimson' }, colour.values[1]] }, size],
      rows,
      'TEE',
    );
    expect(renamed[0]).toMatchObject({ sellingPrice: '9000', attributes: { Color: 'Crimson', Size: 'M' }, sku: 'TEE-CRIMSON-M' });
  });

  it('follows the product SKU until a variant SKU is edited by hand', () => {
    const rows = syncVariants([colour], [], 'TEE');
    rows[1] = { ...rows[1], sku: 'CUSTOM', skuTouched: true };
    const next = syncVariants([colour], rows, 'SHIRT');
    expect(next.map((r) => r.sku)).toEqual(['SHIRT-RED', 'CUSTOM']);
  });
});

describe('validation and payload', () => {
  it('flags missing basics and fake discounts', () => {
    const state = { ...emptyFormState(), sellingPrice: '5000', compareAtPrice: '4000' };
    const errors = validateForm(state);
    expect(Object.keys(errors).sort()).toEqual(['compareAtPrice', 'name', 'sku']);
  });

  it('requires at least one variant switched on', () => {
    const variants = syncVariants([colour], [], 'TEE').map((v) => ({ ...v, enabled: false }));
    const errors = validateForm({ ...emptyFormState(), name: 'Tee', sku: 'TEE', hasVariants: true, options: [colour], variants });
    expect(errors.variants).toMatch(/at least one/);
  });

  it('sends only enabled variants and inherits prices for the checklist', () => {
    const variants = syncVariants([colour], [], 'TEE');
    variants[1].enabled = false;
    variants[0].sellingPrice = '1,200';
    const state = { ...emptyFormState(), name: 'Tee', sku: 'TEE', sellingPrice: '1000', hasVariants: true, options: [colour], variants };
    const input = toProductInput(state);
    expect(input.variants).toEqual([expect.objectContaining({ sku: 'TEE-RED', sellingPrice: 1200, attributes: { Colour: 'Red' } })]);
    expect(input.options?.[0].values[0]).toEqual({ label: 'Red', swatch: '#cc0000' });
    expect(effectivePrices({ ...state, variants: variants.map((v) => ({ ...v, enabled: true, sellingPrice: '' })) })).toEqual([1000, 1000]);
  });

  it('round-trips a saved product, matching variants to option values', () => {
    const product = {
      name: 'Tee', sku: 'TEE', barcode: null, unit: 'pcs', description: null, shortDescription: null, itemType: 'STANDARD', status: 'ACTIVE',
      categoryId: null, brandId: null, preferredSupplierId: null, reorderPoint: null, sellingPrice: 1000, compareAtPrice: null, averageCost: 0,
      slug: 'tee', isPublished: false, publishedAt: null, tags: [], highlights: [], specs: [], images: [], id: 'p1',
      options: [{ name: 'Colour', kind: 'color', values: [{ label: 'Red' }, { label: 'Navy' }] }],
      variants: [{ id: 'v1', sku: 'TEE-RED', barcode: null, attributes: { Colour: 'Red' }, sellingPrice: null, compareAtPrice: null, imageUrl: null, status: 'ACTIVE', available: 3, onlineAvailable: 3 }],
      stockByStore: [], kitComponents: [], hasStockHistory: true, createdAt: '', updatedAt: '',
    } as ProductDetail;
    const state = formStateFromProduct(product);
    expect(state.variants).toHaveLength(2);
    expect(state.variants[0]).toMatchObject({ id: 'v1', enabled: true, available: 3 });
    // a combination the product doesn't sell yet starts switched off
    expect(state.variants[1]).toMatchObject({ enabled: false, sku: 'TEE-NAVY' });
    expect(toProductInput(state).variants).toEqual([expect.objectContaining({ id: 'v1' })]);
  });
});
