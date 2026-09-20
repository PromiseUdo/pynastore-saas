'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Check, CircleAlert, Loader2, Plus, Store, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SwitchRoot } from '@/components/ui/switch';
import { Field, FieldDescription, FieldError, FormGrid } from '@/components/ui/form-field';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ImageUploader } from '@/components/media/image-uploader';
import type { ProductImageSearchStatus } from '@/lib/storefront/visual-search/indexing';
import { ImageSearchStatus } from './ImageSearchStatus';
import { discountPercent, PRODUCT_TAGS, productReadiness, publishBlockers } from '@/features/inventory/product-rules';
import { formatMoney, formatNumber } from '@/lib/format';
import {
  createProduct,
  updateProduct,
  type BrandRow,
  type CategoryWithCounts,
  type ProductDetail,
  type WarehouseRow,
} from '@/features/inventory/actions';
import { CategorySelect } from '../../_components/CategorySelect';
import { AddStockDialog } from '../../_components/AddStockDialog';
import { BrandSelect } from './BrandSelect';
import { FormCard } from './FormCard';
import { HighlightsEditor, SpecsEditor } from './ListEditors';
import { VariantsEditor } from './VariantsEditor';
import {
  effectivePrices,
  effectiveSlug,
  emptyFormState,
  formStateFromProduct,
  syncVariants,
  toProductInput,
  validateForm,
  type FieldErrors,
  type FormState,
} from './product-form-state';

type ProductFormProps = {
  product: ProductDetail | null;
  categories: CategoryWithCounts[];
  brands: BrandRow[];
  suppliers: { id: string; name: string }[];
  warehouses: WarehouseRow[];
  can: { save: boolean; createBrand: boolean; recordStock: boolean };
  /** saved products only: how ready their photos are for search by image */
  imageSearch?: ProductImageSearchStatus | null;
};

const STATUS_HELP = {
  ACTIVE: 'Available to stock and sell.',
  DISCONTINUED: 'You’re not restocking it. Remaining stock can still be sold.',
  ARCHIVED: 'Hidden from product lists and can’t be sold. History is kept.',
} as const;

/** Where each error key is shown, for the summary's jump links. */
const ERROR_ANCHOR: Record<string, string> = {
  name: 'basics',
  shortDescription: 'basics',
  sellingPrice: 'pricing',
  compareAtPrice: 'pricing',
  sku: 'inventory',
  reorderPoint: 'inventory',
  options: 'variants',
  variants: 'variants',
  highlights: 'details',
  specs: 'details',
  slug: 'online',
  publish: 'online',
  status: 'status',
};

function categoryIsVisible(categories: CategoryWithCounts[], id: string | null): boolean {
  if (!id) return false;
  const byId = new Map(categories.map((c) => [c.id, c]));
  let current = byId.get(id);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (!current.isVisible) return false;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return Boolean(byId.get(id));
}

export function ProductForm({ product, categories, brands: initialBrands, suppliers, warehouses, can, imageSearch }: ProductFormProps) {
  const router = useRouter();
  const isNew = product === null;
  const isKit = product?.itemType === 'KIT';
  const readOnly = !can.save;

  const initial = React.useMemo(() => (product ? formStateFromProduct(product) : emptyFormState()), [product]);
  const [state, setState] = React.useState<FormState>(initial);
  const [savedSnapshot, setSavedSnapshot] = React.useState(() => JSON.stringify(initial));
  const [brands, setBrands] = React.useState(initialBrands);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [submitted, setSubmitted] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  /* Stock is recorded per store, so it can't live on this form. A product
   * created a moment ago goes straight to the "how many do you have?" step
   * (see save()), and the Stock card can reopen it any time. */
  const searchParams = useSearchParams();
  const [stockOpen, setStockOpen] = React.useState(false);
  const [stockMode, setStockMode] = React.useState<'add' | 'opening'>('add');

  React.useEffect(() => {
    if (searchParams.get('stock') !== 'opening' || !product) return;
    if (product.stockByStore.some((s) => s.onHand !== 0)) return;
    setStockMode('opening');
    setStockOpen(true);
  }, [searchParams, product]);

  // A fresh server copy (after save + refresh) becomes the new baseline.
  React.useEffect(() => {
    setState(initial);
    setSavedSnapshot(JSON.stringify(initial));
  }, [initial]);

  const dirty = JSON.stringify(state) !== savedSnapshot;

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState((s) => ({ ...s, [key]: value }));

  // Live errors once the user has tried to save.
  React.useEffect(() => {
    if (submitted) setErrors(clientErrors(state));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, submitted]);

  const onlineStores = warehouses.filter((w) => w.sellsOnline && w.status === 'ACTIVE');
  const onlineAvailable = product
    ? product.stockByStore.filter((s) => s.sellsOnline).reduce((sum, s) => sum + Math.max(0, s.available), 0)
    : null;

  const readiness = productReadiness({
    imageCount: state.images.length,
    prices: effectivePrices(state),
    hasCategory: Boolean(state.categoryId),
    categoryVisible: categoryIsVisible(categories, state.categoryId),
    hasDescription: Boolean(state.description.trim() || state.shortDescription.trim()),
    onlineStoreCount: onlineStores.length,
    onlineAvailable,
  });
  const blockers = publishBlockers(readiness);

  function clientErrors(s: FormState): FieldErrors {
    const found = validateForm(s);
    if (s.isPublished) {
      const b = publishBlockers(
        productReadiness({
          imageCount: s.images.length,
          prices: effectivePrices(s),
          hasCategory: Boolean(s.categoryId),
          categoryVisible: true,
          hasDescription: true,
          onlineStoreCount: 1,
          onlineAvailable: null,
        }),
      );
      if (b.length) found.publish = `To publish, first fix: ${b.map((x) => x.label.toLowerCase()).join(' and ')} — or switch publishing off to save a draft.`;
      if (s.status !== 'ACTIVE') found.status = 'Only active products can be on your online store.';
    }
    return found;
  }

  async function save() {
    if (readOnly || saving) return;
    setSubmitted(true);
    setFormError(null);
    const found = clientErrors(state);
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error('Some details need fixing before you can save.');
      document.getElementById('form-errors')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (uploading) {
      toast.error('Wait for images to finish uploading.');
      return;
    }

    setSaving(true);
    const input = toProductInput(state);
    const result = isNew ? await createProduct(input) : await updateProduct(product.id, input);
    setSaving(false);

    if (!result.success) {
      setFormError(result.error);
      toast.error(result.error);
      document.getElementById('form-errors')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    setSubmitted(false);
    setErrors({});
    setSavedSnapshot(JSON.stringify(state));
    if (isNew) {
      toast.success(`Created “${input.name}”`);
      // ?stock=opening opens the "how many do you have?" step on arrival.
      const query = can.recordStock ? '?stock=opening' : '';
      router.replace(`/inventory/products/${(result.data as { id: string }).id}${query}`);
    } else {
      toast.success('Changes saved');
      router.refresh();
    }
  }

  // ⌘S / Ctrl+S saves.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const errorEntries = Object.entries(errors);
  const price = Number(state.sellingPrice.replace(/,/g, '')) || null;
  const was = Number(state.compareAtPrice.replace(/,/g, '')) || null;
  const pct = discountPercent(price, was);
  const slug = effectiveSlug(state);
  const margin = product && price && product.averageCost > 0 ? Math.round(((price - product.averageCost) / price) * 100) : null;
  const canUseVariants = !isKit && !(product && !initial.hasVariants && product.hasStockHistory);

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="border-b bg-background px-4 py-4 sm:px-6">
        <Link href="/inventory/products" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" /> Products
        </Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
              {isNew ? state.name.trim() || 'New product' : product.name}
            </h1>
            {isKit && <Badge variant="info">Kit</Badge>}
            {!isNew && (product.isPublished ? <Badge variant="success" dot>Published</Badge> : <Badge variant="draft">Not published</Badge>)}
            {!isNew && product.status !== 'ACTIVE' && <Badge variant="warning">{product.status === 'ARCHIVED' ? 'Archived' : 'Discontinued'}</Badge>}
          </div>
          {!readOnly && (
            <div className="flex items-center gap-2">
              {dirty && !isNew && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setState(initial); setErrors({}); setSubmitted(false); setFormError(null); }}>
                  Discard changes
                </Button>
              )}
              <Button type="submit" size="sm" disabled={saving || (!dirty && !isNew)}>
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {isNew ? 'Save product' : 'Save changes'}
              </Button>
            </div>
          )}
        </div>
        {readOnly && <p className="mt-1 text-xs text-muted-foreground">You can view this product, but your role can’t change it.</p>}
      </div>

      <fieldset disabled={readOnly} className="px-4 py-6 sm:px-6">
        {(formError || (submitted && errorEntries.length > 0)) && (
          <div id="form-errors" role="alert" className="mb-5 scroll-mt-20 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <CircleAlert className="size-4" />
              {formError ?? `Fix ${errorEntries.length === 1 ? 'this' : `these ${errorEntries.length} things`} to save`}
            </p>
            {!formError && (
              <ul className="mt-2 list-disc space-y-1 pl-9 text-destructive">
                {errorEntries.map(([key, message]) => (
                  <li key={key}>
                    <a href={`#${ERROR_ANCHOR[key] ?? 'basics'}`} className="underline-offset-2 hover:underline">
                      {message}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
          {/* ── Main column ─────────────────────────────────────── */}
          <div className="min-w-0 space-y-5">
            <FormCard id="basics" title="Basic information">
              <Field>
                <Label htmlFor="p-name">Name *</Label>
                <Input id="p-name" value={state.name} onChange={(e) => set('name', e.target.value)} aria-invalid={Boolean(errors.name)} placeholder="e.g. Classic Cotton T-Shirt" autoFocus={isNew} />
                {errors.name && <FieldError>{errors.name}</FieldError>}
              </Field>
              <Field>
                <Label htmlFor="p-short">Short description</Label>
                <Input id="p-short" value={state.shortDescription} maxLength={200} onChange={(e) => set('shortDescription', e.target.value)} aria-invalid={Boolean(errors.shortDescription)} placeholder="One line shown under the name in your online store" />
                {errors.shortDescription ? <FieldError>{errors.shortDescription}</FieldError> : <FieldDescription>{state.shortDescription.length}/200</FieldDescription>}
              </Field>
              <Field>
                <Label htmlFor="p-desc">Description</Label>
                <Textarea id="p-desc" className="min-h-32" value={state.description} maxLength={5000} onChange={(e) => set('description', e.target.value)} placeholder="What it is, what it’s made of, how to use or care for it." />
              </Field>
            </FormCard>

            <FormCard id="images" title="Images" description="The first image is the one customers see first. Add a few angles — products with photos sell far better.">
              <ImageUploader purpose="products" value={state.images} onChange={(images) => set('images', images)} onBusyChange={setUploading} disabled={readOnly} />
              {product && imageSearch && <ImageSearchStatus productId={product.id} status={imageSearch} canRetry={can.save} />}
            </FormCard>

            <FormCard id="pricing" title="Pricing" description={state.hasVariants ? 'The default price for every variant. You can set different prices per variant below.' : undefined}>
              <FormGrid>
                <Field>
                  <Label htmlFor="p-price">Selling price</Label>
                  <Input id="p-price" inputMode="decimal" startAdornment={<span className="text-xs">₦</span>} value={state.sellingPrice} onChange={(e) => set('sellingPrice', e.target.value)} aria-invalid={Boolean(errors.sellingPrice)} placeholder="0" />
                  {errors.sellingPrice && <FieldError>{errors.sellingPrice}</FieldError>}
                </Field>
                {!state.hasVariants && (
                  <Field>
                    <Label htmlFor="p-was">“Was” price</Label>
                    <Input id="p-was" inputMode="decimal" startAdornment={<span className="text-xs">₦</span>} value={state.compareAtPrice} onChange={(e) => set('compareAtPrice', e.target.value)} aria-invalid={Boolean(errors.compareAtPrice)} placeholder="Optional" />
                    {errors.compareAtPrice ? (
                      <FieldError>{errors.compareAtPrice}</FieldError>
                    ) : (
                      <FieldDescription>{pct ? `Customers see ${pct}% off, with the old price crossed out.` : 'Shown crossed out to mark a discount.'}</FieldDescription>
                    )}
                  </Field>
                )}
              </FormGrid>
              {product && product.averageCost > 0 && (
                <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  Average cost {formatMoney(product.averageCost)}
                  {margin !== null && <> · Margin at this price <span className={cn('font-medium', margin < 0 ? 'text-destructive' : 'text-foreground')}>{margin}%</span></>}
                </p>
              )}
            </FormCard>

            {!isKit && (
              <FormCard
                id="variants"
                title="Variants"
                description="For products sold in different sizes, colours or materials. Each variant has its own stock."
                actions={
                  !readOnly && canUseVariants ? (
                    <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <SwitchRoot
                        checked={state.hasVariants}
                        onCheckedChange={(on) =>
                          setState((s) => ({
                            ...s,
                            hasVariants: on,
                            options: on && s.options.length === 0 ? [{ key: `new-${Date.now()}`, name: '', kind: 'select', values: [] }] : s.options,
                          }))
                        }
                      />
                      Has variants
                    </label>
                  ) : undefined
                }
              >
                {!canUseVariants ? (
                  <p className="text-sm text-muted-foreground">
                    This product already has stock or sales history, so it can’t be split into variants. Create a new product with variants and archive this one instead.
                  </p>
                ) : state.hasVariants ? (
                  <VariantsEditor
                    options={state.options}
                    variants={state.variants}
                    parentSku={state.sku}
                    basePrice={state.sellingPrice}
                    images={state.images}
                    errors={{ options: errors.options, variants: errors.variants }}
                    disabled={readOnly}
                    showStock={!isNew}
                    onChange={(options, variants) => setState((s) => ({ ...s, options, variants }))}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">This product is sold as a single item. Turn on variants if it comes in options like sizes or colours.</p>
                )}
              </FormCard>
            )}

            {isKit && product && (
              <FormCard id="kit" title="Kit contents" description="Assembling one kit uses these components.">
                <ul className="divide-y rounded-md border text-sm">
                  {product.kitComponents.map((c) => (
                    <li key={c.id} className="flex items-center justify-between px-3 py-2">
                      <span>
                        {c.name} <span className="font-mono text-xs text-muted-foreground">{c.sku}</span>
                      </span>
                      <span className="tabular-nums text-muted-foreground">× {formatNumber(c.quantity)}</span>
                    </li>
                  ))}
                </ul>
              </FormCard>
            )}

            <FormCard id="inventory" title="Inventory">
              <FormGrid>
                <Field>
                  <Label htmlFor="p-sku">SKU *</Label>
                  <Input
                    id="p-sku"
                    className="font-mono"
                    value={state.sku}
                    onChange={(e) => {
                      const sku = e.target.value;
                      setState((s) => ({ ...s, sku, variants: s.hasVariants ? syncVariants(s.options, s.variants, sku) : s.variants }));
                    }}
                    aria-invalid={Boolean(errors.sku)}
                    placeholder="e.g. TEE-001"
                  />
                  {errors.sku ? <FieldError>{errors.sku}</FieldError> : <FieldDescription>Your own code for this product. {state.hasVariants && 'Variant SKUs are built from it.'}</FieldDescription>}
                </Field>
                {!state.hasVariants && (
                  <Field>
                    <Label htmlFor="p-barcode">Barcode</Label>
                    <Input id="p-barcode" value={state.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder="Scan or type" />
                  </Field>
                )}
                <Field>
                  <Label htmlFor="p-unit">Unit</Label>
                  <Input id="p-unit" value={state.unit} maxLength={20} onChange={(e) => set('unit', e.target.value)} list="unit-suggestions" />
                  <datalist id="unit-suggestions">
                    {['pcs', 'pair', 'box', 'pack', 'kg', 'g', 'L', 'ml', 'm'].map((u) => <option key={u} value={u} />)}
                  </datalist>
                  <FieldDescription>How you count it, e.g. pcs, box, kg.</FieldDescription>
                </Field>
                <Field>
                  <Label htmlFor="p-reorder">Reorder point (low-stock warning)</Label>
                  <Input id="p-reorder" inputMode="numeric" value={state.reorderPoint} onChange={(e) => set('reorderPoint', e.target.value)} aria-invalid={Boolean(errors.reorderPoint)} placeholder="Optional" />
                  {errors.reorderPoint ? (
                    <FieldError>{errors.reorderPoint}</FieldError>
                  ) : (
                    <FieldDescription>
                      Warn me when stock{state.hasVariants ? ' of a variant' : ''} drops to this number. It isn’t the amount you
                      have — leave it blank for no warning.
                    </FieldDescription>
                  )}
                </Field>
                <Field className="sm:col-span-2">
                  <Label htmlFor="p-supplier">Preferred supplier</Label>
                  <SelectRoot value={state.preferredSupplierId ?? '__none__'} onValueChange={(v) => set('preferredSupplierId', v === '__none__' ? null : v)}>
                    <SelectTrigger id="p-supplier">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </SelectRoot>
                  <FieldDescription>Used to group automatic reorder suggestions.</FieldDescription>
                </Field>
              </FormGrid>
            </FormCard>

            <FormCard id="details" title="Details for customers" description="Shown on the product page in your online store.">
              <Field>
                <Label>Highlights</Label>
                <FieldDescription>Short selling points shown as a bulleted list.</FieldDescription>
                <HighlightsEditor value={state.highlights} onChange={(v) => set('highlights', v)} disabled={readOnly} />
                {errors.highlights && <FieldError>{errors.highlights}</FieldError>}
              </Field>
              <Field>
                <Label>Specifications</Label>
                <FieldDescription>Facts like material or dimensions. Customers can also filter by these.</FieldDescription>
                <SpecsEditor value={state.specs} onChange={(v) => set('specs', v)} disabled={readOnly} />
                {errors.specs && <FieldError>{errors.specs}</FieldError>}
              </Field>
            </FormCard>
          </div>

          {/* ── Side column ─────────────────────────────────────── */}
          <div className="min-w-0 space-y-5 lg:sticky lg:top-4 lg:self-start">
            <FormCard id="online" title="Online store">
              <label className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-sm font-medium text-foreground">Publish on online store</span>
                  <span className="block text-xs text-muted-foreground">{state.isPublished ? 'Customers can find and buy it.' : 'Only your team can see it.'}</span>
                </span>
                <SwitchRoot checked={state.isPublished} onCheckedChange={(v) => set('isPublished', v)} aria-describedby="readiness" />
              </label>
              {errors.publish && <FieldError>{errors.publish}</FieldError>}

              <ul id="readiness" className="space-y-2" aria-label="Online store checklist">
                {readiness.map((check) => (
                  <li key={check.key} className="flex gap-2 text-xs">
                    {check.ok ? (
                      <Check className="mt-px size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Done" />
                    ) : check.severity === 'blocker' ? (
                      <CircleAlert className="mt-px size-3.5 shrink-0 text-destructive" aria-label="Required" />
                    ) : (
                      <TriangleAlert className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-label="Recommended" />
                    )}
                    <span>
                      <span className={cn('block', check.ok ? 'text-muted-foreground' : 'font-medium text-foreground')}>{check.label}</span>
                      {!check.ok && (
                        <span className="block text-muted-foreground">
                          {check.hint}
                          {check.key === 'stores' && (
                            <> <Link href="/inventory/warehouses" className="text-primary hover:underline">Choose stores</Link></>
                          )}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {blockers.length === 0 && !state.isPublished && (
                <p className="text-xs text-muted-foreground">Ready to publish whenever you are.</p>
              )}

              <Field>
                <Label htmlFor="p-slug">Web address</Label>
                <Input
                  id="p-slug"
                  className="font-mono text-xs"
                  value={slug}
                  onChange={(e) => setState((s) => ({ ...s, slug: e.target.value.toLowerCase(), slugTouched: true }))}
                  aria-invalid={Boolean(errors.slug)}
                />
                {errors.slug ? (
                  <FieldError>{errors.slug}</FieldError>
                ) : (
                  <FieldDescription>
                    <span className="break-all font-mono text-foreground">/products/{slug || '…'}</span>
                    {product?.slug && slug !== product.slug && product.isPublished && ' — changing this breaks links people have saved.'}
                  </FieldDescription>
                )}
              </Field>
            </FormCard>

            <FormCard id="status" title="Status">
              <SelectRoot value={state.status} onValueChange={(v) => set('status', v as FormState['status'])}>
                <SelectTrigger aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="DISCONTINUED">Discontinued</SelectItem>
                  <SelectItem value="ARCHIVED">Archived</SelectItem>
                </SelectContent>
              </SelectRoot>
              {errors.status ? <FieldError>{errors.status}</FieldError> : <FieldDescription>{STATUS_HELP[state.status]}</FieldDescription>}
            </FormCard>

            <FormCard id="organise" title="Organise">
              <Field>
                <Label htmlFor="p-category">Category</Label>
                <CategorySelect id="p-category" categories={categories} value={state.categoryId} onChange={(v) => set('categoryId', v)} noneLabel="Uncategorised" />
                {categories.length === 0 && (
                  <FieldDescription>
                    <Link href="/inventory/categories" className="text-primary hover:underline">Create categories</Link> to organise your catalog.
                  </FieldDescription>
                )}
              </Field>
              <Field>
                <Label htmlFor="p-brand">Brand</Label>
                <BrandSelect
                  id="p-brand"
                  brands={brands}
                  value={state.brandId}
                  onChange={(v) => set('brandId', v)}
                  onBrandCreated={(b) => setBrands((prev) => [...prev, b].sort((a, z) => a.name.localeCompare(z.name)))}
                  canCreate={can.createBrand}
                  disabled={readOnly}
                />
              </Field>
              <Field>
                <Label id="p-tags-label">Tags</Label>
                <div role="group" aria-labelledby="p-tags-label" className="flex flex-wrap gap-1.5">
                  {PRODUCT_TAGS.map((tag) => {
                    const on = state.tags.includes(tag.value);
                    return (
                      <button
                        key={tag.value}
                        type="button"
                        title={tag.hint}
                        aria-pressed={on}
                        onClick={() => set('tags', on ? state.tags.filter((t) => t !== tag.value) : [...state.tags, tag.value])}
                        className={cn(
                          'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors disabled:opacity-50',
                          on ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        {on && <Check className="size-3" />}
                        {tag.label}
                      </button>
                    );
                  })}
                </div>
                <FieldDescription>Controls badges and where it’s featured in your online store.</FieldDescription>
              </Field>
            </FormCard>

            {product && (
              <FormCard
                id="stock"
                title="Stock"
                actions={
                  can.recordStock ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        setStockMode('add');
                        setStockOpen(true);
                      }}
                    >
                      <Plus className="size-3" />
                      Add stock
                    </Button>
                  ) : undefined
                }
              >
                {product.stockByStore.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No stock recorded yet. Add what’s on the shelf, or receive a{' '}
                    <Link href="/procurement/purchase-orders" className="text-primary hover:underline">
                      purchase order
                    </Link>{' '}
                    and it’s counted for you.
                  </p>
                ) : (
                  <ul className="divide-y text-sm">
                    {product.stockByStore.map((s) => (
                      <li key={s.warehouseId} className="flex items-center justify-between gap-2 py-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate">{s.warehouseName}</span>
                          {s.sellsOnline && (
                            <Badge variant="info" title="This store’s stock is sold online">
                              <Store className="size-3" /> Online
                            </Badge>
                          )}
                        </span>
                        <span className="text-right tabular-nums">
                          {formatNumber(s.available)} <span className="text-xs text-muted-foreground">{state.unit}</span>
                          {s.reserved > 0 && <span className="block text-[11px] text-muted-foreground">{formatNumber(s.reserved)} reserved for orders</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {onlineStores.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No store sells online yet. <Link href="/inventory/warehouses" className="text-primary hover:underline">Choose stores</Link>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Quantities come from stock movements — receiving, selling, counting — so every number has a reason behind it.{' '}
                  <Link href="/inventory/movements" className="text-primary hover:underline">
                    See the ledger
                  </Link>
                </p>
              </FormCard>
            )}
          </div>
        </div>

        {!readOnly && dirty && (
          <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
            <p className="text-sm text-muted-foreground">{isNew ? 'This product isn’t saved yet.' : 'You have unsaved changes.'}</p>
            <div className="flex items-center gap-2">
              {isNew ? (
                <Link href="/inventory/products" className="text-sm text-muted-foreground hover:text-foreground">
                  Cancel
                </Link>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setState(initial); setErrors({}); setSubmitted(false); setFormError(null); }}>
                  Discard
                </Button>
              )}
              <Button type="submit" size="sm" disabled={saving}>
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {isNew ? 'Save product' : 'Save changes'}
              </Button>
            </div>
          </div>
        )}
      </fieldset>

      {product && can.recordStock && (
        <AddStockDialog
          open={stockOpen}
          onOpenChange={setStockOpen}
          productId={product.id}
          warehouses={warehouses}
          mode={stockMode}
        />
      )}
    </form>
  );
}
