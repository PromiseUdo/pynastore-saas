'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, CircleAlert, Hand, Loader2, Package, Sparkles } from 'lucide-react';
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
import { cloudinaryImage } from '@/lib/cloudinary/url';
import { formatMoney, formatNumber } from '@/lib/format';
import { SLUG_PATTERN, buildCategoryTree, flattenCategoryTree, slugify } from '@/features/inventory/category-tree';
import { PRODUCT_TAGS } from '@/features/inventory/product-rules';
import { COLLECTION_SORTS, ruleProblem, ruleSummary, type CollectionRule } from '@/features/inventory/collection-rules';
import {
  createCollection,
  updateCollection,
  previewCollection,
  type CategoryWithCounts,
  type CollectionDetail,
  type CollectionProductRow,
} from '@/features/inventory/actions';
import type { CollectionKind, CollectionSort } from '@/lib/generated/prisma/enums';
import { CategorySelect } from '../../_components/CategorySelect';
import { FormCard } from '../../products/_components/FormCard';
import { ProductPicker } from './ProductPicker';

type Img = { url: string; publicId: string };

type FormState = {
  name: string;
  tagline: string;
  description: string;
  slug: string;
  slugTouched: boolean;
  image: Img[];
  heroImage: Img[];
  isVisible: boolean;
  isFeatured: boolean;
  kind: CollectionKind;
  sort: CollectionSort;
  matchCategoryId: string | null;
  matchTag: string | null;
  matchMinPrice: string;
  matchMaxPrice: string;
  matchCreatedWithinDays: string;
  products: CollectionProductRow[];
};

function initialState(c: CollectionDetail | null): FormState {
  const num = (n: number | null) => (n === null ? '' : String(n));
  return {
    name: c?.name ?? '',
    tagline: c?.tagline ?? '',
    description: c?.description ?? '',
    slug: c?.slug ?? '',
    slugTouched: Boolean(c?.slug),
    image: c?.imageUrl ? [{ url: c.imageUrl, publicId: c.imagePublicId ?? c.imageUrl }] : [],
    heroImage: c?.heroImageUrl ? [{ url: c.heroImageUrl, publicId: c.heroPublicId ?? c.heroImageUrl }] : [],
    isVisible: c?.isVisible ?? true,
    isFeatured: c?.isFeatured ?? false,
    kind: c?.kind ?? 'CURATED',
    sort: c?.sort ?? 'RELEVANCE',
    matchCategoryId: c?.matchCategoryId ?? null,
    matchTag: c?.matchTag ?? null,
    matchMinPrice: num(c?.matchMinPrice ?? null),
    matchMaxPrice: num(c?.matchMaxPrice ?? null),
    matchCreatedWithinDays: num(c?.matchCreatedWithinDays ?? null),
    products: c?.kind === 'CURATED' ? (c?.products ?? []) : [],
  };
}

function toRule(state: FormState): CollectionRule {
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));
  return {
    matchCategoryId: state.matchCategoryId,
    matchTag: state.matchTag,
    matchMinPrice: num(state.matchMinPrice),
    matchMaxPrice: num(state.matchMaxPrice),
    matchCreatedWithinDays: num(state.matchCreatedWithinDays),
  };
}

/** Where each error is shown, for the summary's jump links. */
const ERROR_ANCHOR: Record<string, string> = { name: 'basics', rule: 'products', slug: 'online' };

type CollectionFormProps = {
  collection: CollectionDetail | null;
  categories: CategoryWithCounts[];
  canSave: boolean;
};

export function CollectionForm({ collection, categories, canSave }: CollectionFormProps) {
  const router = useRouter();
  const isNew = collection === null;

  const initial = React.useMemo(() => initialState(collection), [collection]);
  const [state, setState] = React.useState(initial);
  const [snapshot, setSnapshot] = React.useState(() => JSON.stringify(initial));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [preview, setPreview] = React.useState<{ total: number; publishedCount: number; products: CollectionProductRow[] } | null>(
    collection?.kind === 'DYNAMIC' ? { total: collection.productCount, publishedCount: collection.publishedCount, products: collection.products } : null,
  );
  const [previewing, setPreviewing] = React.useState(false);

  React.useEffect(() => {
    setState(initial);
    setSnapshot(JSON.stringify(initial));
  }, [initial]);

  const dirty = JSON.stringify(state) !== snapshot;

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState((s) => ({ ...s, [key]: value }));

  // Once the user has tried to save, keep the summary in step with their edits.
  React.useEffect(() => {
    setErrors((current) => (Object.keys(current).length === 0 ? current : validate()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const rule = toRule(state);
  const ruleKey = JSON.stringify([rule, state.sort]);
  const isDynamic = state.kind === 'DYNAMIC';

  // Live preview of what an automatic collection would hold.
  React.useEffect(() => {
    if (!isDynamic) return;
    if (ruleProblem(rule)) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const timer = setTimeout(async () => {
      const result = await previewCollection(rule, state.sort);
      if (cancelled) return;
      setPreview(result.success ? result.data : null);
      setPreviewing(false);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rule/sort compared by value
  }, [ruleKey, isDynamic]);

  const effectiveSlug = state.slugTouched ? state.slug.trim() : state.name.trim() ? slugify(state.name) : '';
  const categoryPath = React.useMemo(
    () => flattenCategoryTree(buildCategoryTree(categories)).find((c) => c.id === state.matchCategoryId)?.namePath,
    [categories, state.matchCategoryId],
  );

  function validate(): Record<string, string> {
    const found: Record<string, string> = {};
    if (!state.name.trim()) found.name = 'Give the collection a name.';
    if (effectiveSlug && !SLUG_PATTERN.test(effectiveSlug)) found.slug = 'Use lowercase letters, numbers and single hyphens only.';
    if (isDynamic) {
      const problem = ruleProblem(rule);
      if (problem) found.rule = problem;
    }
    return found;
  }

  async function save() {
    if (!canSave || saving) return;
    const found = validate();
    setErrors(found);
    setFormError(null);
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
    const input = {
      name: state.name.trim(),
      slug: state.slugTouched ? state.slug.trim() : '',
      tagline: state.tagline.trim(),
      description: state.description.trim(),
      image: state.image[0] ?? null,
      heroImage: state.heroImage[0] ?? null,
      isVisible: state.isVisible,
      isFeatured: state.isFeatured,
      kind: state.kind,
      sort: state.sort,
      ...rule,
      productIds: state.products.map((p) => p.id),
    };
    const result = isNew ? await createCollection(input) : await updateCollection(collection.id, input);
    setSaving(false);

    if (!result.success) {
      setFormError(result.error);
      toast.error(result.error);
      return;
    }
    setSnapshot(JSON.stringify(state));
    if (isNew) {
      toast.success(`Created “${input.name}”`);
      router.replace(`/inventory/collections/${(result.data as { id: string }).id}`);
    } else {
      toast.success('Changes saved');
      router.refresh();
    }
  }

  const shownProducts = isDynamic ? (preview?.products ?? []) : state.products;
  const total = isDynamic ? (preview?.total ?? 0) : state.products.length;
  const publishedCount = isDynamic ? (preview?.publishedCount ?? 0) : state.products.filter((p) => p.isPublished && p.status === 'ACTIVE').length;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="border-b bg-background px-4 py-4 sm:px-6">
        <Link href="/inventory/collections" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" /> Collections
        </Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
              {isNew ? state.name.trim() || 'New collection' : collection.name}
            </h1>
            <Badge variant={isDynamic ? 'info' : 'muted'}>{isDynamic ? 'Automatic' : 'Hand-picked'}</Badge>
            {!state.isVisible && <Badge variant="draft">Hidden</Badge>}
          </div>
          {canSave && (
            <div className="flex items-center gap-2">
              {dirty && !isNew && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setState(initial); setErrors({}); setFormError(null); }}>
                  Discard changes
                </Button>
              )}
              <Button type="submit" size="sm" disabled={saving || (!dirty && !isNew)}>
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {isNew ? 'Save collection' : 'Save changes'}
              </Button>
            </div>
          )}
        </div>
      </div>

      <fieldset disabled={!canSave} className="px-4 py-6 sm:px-6">
        {(formError || Object.keys(errors).length > 0) && (
          <div id="form-errors" role="alert" className="mb-5 scroll-mt-20 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <CircleAlert className="size-4" />
              {formError ?? `Fix ${Object.keys(errors).length === 1 ? 'this' : `these ${Object.keys(errors).length} things`} to save`}
            </p>
            {!formError && (
              <ul className="mt-2 list-disc space-y-1 pl-9 text-destructive">
                {Object.entries(errors).map(([key, message]) => (
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
          <div className="min-w-0 space-y-5">
            <FormCard id="basics" title="Basic information">
              <Field>
                <Label htmlFor="c-name">Name *</Label>
                <Input id="c-name" autoFocus={isNew} placeholder="e.g. Travel essentials" value={state.name} onChange={(e) => set('name', e.target.value)} aria-invalid={Boolean(errors.name)} />
                {errors.name && <FieldError>{errors.name}</FieldError>}
              </Field>
              <Field>
                <Label htmlFor="c-tagline">Tagline</Label>
                <Input id="c-tagline" maxLength={160} placeholder="One line shown under the title" value={state.tagline} onChange={(e) => set('tagline', e.target.value)} />
              </Field>
              <Field>
                <Label htmlFor="c-desc">Description</Label>
                <Textarea id="c-desc" className="min-h-24" maxLength={2000} placeholder="Why these products belong together." value={state.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
            </FormCard>

            <FormCard
              id="products"
              title="Products"
              description={isDynamic ? 'Products are chosen automatically by your conditions, and update as your catalog changes.' : 'Choose products by hand, in the order customers should see them.'}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    { kind: 'CURATED' as const, icon: Hand, title: 'Hand-picked', hint: 'You choose each product and its order.' },
                    { kind: 'DYNAMIC' as const, icon: Sparkles, title: 'Automatic', hint: 'Set conditions; products join and leave on their own.' },
                  ]
                ).map(({ kind, icon: Icon, title, hint }) => (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={state.kind === kind}
                    onClick={() => set('kind', kind)}
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                      state.kind === kind ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Icon className="size-4" />
                      {title}
                    </span>
                    <span className="text-xs text-muted-foreground">{hint}</span>
                  </button>
                ))}
              </div>

              {isDynamic ? (
                <div className="space-y-4">
                  <FormGrid>
                    <Field>
                      <Label htmlFor="c-category">Category</Label>
                      <CategorySelect id="c-category" categories={categories} value={state.matchCategoryId} onChange={(v) => set('matchCategoryId', v)} noneLabel="Any category" />
                      <FieldDescription>Includes everything in its subcategories too.</FieldDescription>
                    </Field>
                    <Field>
                      <Label htmlFor="c-tag">Tag</Label>
                      <SelectRoot value={state.matchTag ?? '__any__'} onValueChange={(v) => set('matchTag', v === '__any__' ? null : v)}>
                        <SelectTrigger id="c-tag">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__any__">Any tag</SelectItem>
                          {PRODUCT_TAGS.map((tag) => (
                            <SelectItem key={tag.value} value={tag.value}>
                              {tag.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </SelectRoot>
                    </Field>
                    <Field>
                      <Label htmlFor="c-min">Lowest price</Label>
                      <Input id="c-min" inputMode="decimal" startAdornment={<span className="text-xs">₦</span>} placeholder="Any" value={state.matchMinPrice} onChange={(e) => set('matchMinPrice', e.target.value)} />
                    </Field>
                    <Field>
                      <Label htmlFor="c-max">Highest price</Label>
                      <Input id="c-max" inputMode="decimal" startAdornment={<span className="text-xs">₦</span>} placeholder="Any" value={state.matchMaxPrice} onChange={(e) => set('matchMaxPrice', e.target.value)} />
                    </Field>
                    <Field className="sm:col-span-2">
                      <Label htmlFor="c-days">Added in the last…</Label>
                      <Input id="c-days" inputMode="numeric" endAdornment={<span className="text-xs text-muted-foreground">days</span>} placeholder="Any time" value={state.matchCreatedWithinDays} onChange={(e) => set('matchCreatedWithinDays', e.target.value)} />
                      <FieldDescription>Use this for a “New in” collection that keeps itself up to date.</FieldDescription>
                    </Field>
                  </FormGrid>

                  {errors.rule ? (
                    <FieldError>{errors.rule}</FieldError>
                  ) : (
                    <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                      {ruleSummary(rule, { categoryPath, formatMoney: (n) => formatMoney(n) })}
                    </p>
                  )}
                </div>
              ) : (
                <ProductPicker value={state.products} onChange={(products) => set('products', products)} disabled={!canSave} />
              )}
            </FormCard>

            {isDynamic && (
              <FormCard
                id="preview"
                title="What’s in it right now"
                description={previewing ? 'Checking…' : `${formatNumber(total)} product${total === 1 ? '' : 's'} match, ${formatNumber(publishedCount)} visible to customers.`}
              >
                {previewing ? (
                  <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Finding matching products…
                  </p>
                ) : shownProducts.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    Nothing matches these conditions yet. The collection stays hidden from customers until something does.
                  </p>
                ) : (
                  <>
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {shownProducts.map((product) => (
                        <li key={product.id} className="overflow-hidden rounded-lg border">
                          <div className="flex aspect-square items-center justify-center bg-muted text-muted-foreground">
                            {product.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- Cloudinary does the resizing
                              <img src={cloudinaryImage(product.imageUrl, { width: 240, height: 240 })} alt="" className="size-full object-cover" />
                            ) : (
                              <Package className="size-5" />
                            )}
                          </div>
                          <div className="space-y-0.5 p-2">
                            <p className="truncate text-xs font-medium text-foreground">{product.name}</p>
                            <p className="text-xs text-muted-foreground">{formatMoney(product.price)}</p>
                            {!product.isPublished && <Badge variant="draft">Not published</Badge>}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {total > shownProducts.length && (
                      <p className="text-xs text-muted-foreground">Showing the first {shownProducts.length} of {formatNumber(total)}.</p>
                    )}
                  </>
                )}
              </FormCard>
            )}
          </div>

          <div className="min-w-0 space-y-5 lg:sticky lg:top-4 lg:self-start">
            <FormCard id="online" title="Online store">
              <label className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-sm font-medium text-foreground">Show in online store</span>
                  <span className="block text-xs text-muted-foreground">{state.isVisible ? 'Customers can open this collection.' : 'Only your team can see it.'}</span>
                </span>
                <SwitchRoot checked={state.isVisible} onCheckedChange={(v) => set('isVisible', v)} />
              </label>
              <label className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-sm font-medium text-foreground">Feature it</span>
                  <span className="block text-xs text-muted-foreground">Promote it in navigation and on the collections page.</span>
                </span>
                <SwitchRoot checked={state.isFeatured} onCheckedChange={(v) => set('isFeatured', v)} />
              </label>

              {publishedCount === 0 && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  {total === 0
                    ? 'Empty collections aren’t shown to customers.'
                    : 'None of these products are published yet, so customers won’t see this collection.'}
                </p>
              )}

              <Field>
                <Label htmlFor="c-slug">Web address</Label>
                <Input
                  id="c-slug"
                  className="font-mono text-xs"
                  value={effectiveSlug}
                  onChange={(e) => setState((s) => ({ ...s, slug: e.target.value.toLowerCase(), slugTouched: true }))}
                  aria-invalid={Boolean(errors.slug)}
                />
                {errors.slug ? (
                  <FieldError>{errors.slug}</FieldError>
                ) : (
                  <FieldDescription>
                    <span className="break-all font-mono text-foreground">/collections/{effectiveSlug || '…'}</span>
                  </FieldDescription>
                )}
              </Field>

              <Field>
                <Label htmlFor="c-sort">Product order</Label>
                <SelectRoot value={state.sort} onValueChange={(v) => set('sort', v as CollectionSort)}>
                  <SelectTrigger id="c-sort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLLECTION_SORTS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
                <FieldDescription>
                  {state.kind === 'CURATED'
                    ? 'Hand-picked collections keep your order; this is used when a customer hasn’t chosen a sort.'
                    : COLLECTION_SORTS.find((s) => s.value === state.sort)?.hint}
                </FieldDescription>
              </Field>
            </FormCard>

            <FormCard id="images" title="Images" description="Optional, but a collection with a picture gets far more clicks.">
              <Field>
                <Label>Card image</Label>
                <ImageUploader purpose="products" max={1} value={state.image} onChange={(v) => set('image', v.map((i) => ({ url: i.url, publicId: i.publicId })))} onBusyChange={setUploading} hint="Square works best — used on the collections page." />
              </Field>
              <Field>
                <Label>Banner image</Label>
                <ImageUploader purpose="products" max={1} value={state.heroImage} onChange={(v) => set('heroImage', v.map((i) => ({ url: i.url, publicId: i.publicId })))} onBusyChange={setUploading} hint="Wide image shown at the top of the collection page." />
              </Field>
            </FormCard>
          </div>
        </div>

        {canSave && dirty && (
          <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
            <p className="text-sm text-muted-foreground">{isNew ? 'This collection isn’t saved yet.' : 'You have unsaved changes.'}</p>
            <div className="flex items-center gap-2">
              {isNew ? (
                <Link href="/inventory/collections" className="text-sm text-muted-foreground hover:text-foreground">
                  Cancel
                </Link>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setState(initial); setErrors({}); setFormError(null); }}>
                  Discard
                </Button>
              )}
              <Button type="submit" size="sm" disabled={saving}>
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {isNew ? 'Save collection' : 'Save changes'}
              </Button>
            </div>
          </div>
        )}
      </fieldset>
    </form>
  );
}
