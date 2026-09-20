'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, X } from 'lucide-react';
import { ImageUploader } from '@/components/media/image-uploader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CheckboxRoot } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FormSection } from '@/components/ui/form-field';
import {
  SheetRoot,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/sheet';
import { createCategory, updateCategory, type CategoryWithCounts } from '@/features/inventory/actions';
import {
  MAX_CATEGORY_DEPTH,
  MAX_COMPANIONS,
  SLUG_PATTERN,
  buildCategoryTree,
  flattenCategoryTree,
  parentProblem,
  slugify,
  storefrontCategoryPath,
} from '@/features/inventory/category-tree';
import { CategorySelect } from '../../_components/CategorySelect';

const DESCRIPTION_MAX = 500;
const COMPANION_TITLE_MAX = 40;

type CategorySheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: CategoryWithCounts[];
  /** the category being edited; null = create */
  editing: CategoryWithCounts | null;
  /** preselected parent when creating ("Add subcategory") */
  defaultParentId?: string | null;
};

type FieldErrors = Partial<
  Record<'name' | 'slug' | 'parentId' | 'imageUrl' | 'description' | 'companionTitle', string>
>;

export function CategorySheet({ open, onOpenChange, categories, editing, defaultParentId = null }: CategorySheetProps) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [parentId, setParentId] = React.useState<string | null>(null);
  const [slug, setSlug] = React.useState('');
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [description, setDescription] = React.useState('');
  const [imageUrl, setImageUrl] = React.useState('');
  const [uploading, setUploading] = React.useState(false);
  const [isVisible, setIsVisible] = React.useState(true);
  const [isFeatured, setIsFeatured] = React.useState(false);
  const [companionIds, setCompanionIds] = React.useState<string[]>([]);
  const [companionTitle, setCompanionTitle] = React.useState('');
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setParentId(editing ? editing.parentId : defaultParentId);
    setSlug(editing?.slug ?? '');
    // Existing categories keep their URL unless the user edits it on purpose.
    setSlugTouched(Boolean(editing));
    setDescription(editing?.description ?? '');
    setImageUrl(editing?.imageUrl ?? '');
    setIsVisible(editing?.isVisible ?? true);
    setIsFeatured(editing?.isFeatured ?? false);
    setCompanionIds(editing?.companionIds ?? []);
    setCompanionTitle(editing?.companionTitle ?? '');
    setErrors({});
    setFormError(null);
  }, [open, editing, defaultParentId]);

  const tree = React.useMemo(() => flattenCategoryTree(buildCategoryTree(categories)), [categories]);
  const parent = tree.find((c) => c.id === parentId) ?? null;
  const effectiveSlug = slugTouched ? slug : slugify(name);
  const urlPreview = storefrontCategoryPath([...(parent?.slugPath ?? []), effectiveSlug || '…']);
  const isTopLevel = parentId === null;
  // A paired category that has since been deleted simply isn't listed.
  const companions = companionIds
    .map((id) => tree.find((c) => c.id === id))
    .filter((c): c is (typeof tree)[number] => Boolean(c));

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = 'Give the category a name.';
    if (effectiveSlug && !SLUG_PATTERN.test(effectiveSlug)) {
      next.slug = 'Use lowercase letters, numbers and single hyphens only.';
    }
    const problem = parentProblem(categories, editing?.id ?? null, parentId);
    if (problem) next.parentId = problem;
    if (imageUrl.trim() && !/^https?:\/\/\S+$/.test(imageUrl.trim())) {
      next.imageUrl = 'Enter a full image link starting with https://';
    }
    if (description.length > DESCRIPTION_MAX) next.description = `Keep it under ${DESCRIPTION_MAX} characters.`;
    if (companionTitle.trim().length > COMPANION_TITLE_MAX) {
      next.companionTitle = `Keep it under ${COMPANION_TITLE_MAX} characters.`;
    }
    return next;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;
    if (uploading) {
      setFormError('Wait for the image to finish uploading.');
      return;
    }

    setIsPending(true);
    const input = {
      name: name.trim(),
      parentId,
      slug: slugTouched ? slug.trim() : '',
      description: description.trim(),
      imageUrl: imageUrl.trim(),
      isVisible,
      isFeatured: isTopLevel && isFeatured,
      companionIds: companions.map((c) => c.id),
      companionTitle: companionTitle.trim(),
    };
    const result = editing ? await updateCategory(editing.id, input) : await createCategory(input);
    setIsPending(false);

    if (!result.success) {
      setFormError(result.error);
      return;
    }
    toast.success(editing ? `Saved “${input.name}”` : `Created “${input.name}”`);
    router.refresh();
    onOpenChange(false);
  }

  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <SheetHeader>
            <SheetTitle>{editing ? `Edit “${editing.name}”` : parent ? `New subcategory in ${parent.name}` : 'New category'}</SheetTitle>
            <SheetDescription>
              Categories organise your stock and become the departments customers browse in your online store.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-8 overflow-y-auto px-6 py-5">
            {formError && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            )}

            <FormSection title="Details">
              <Field>
                <Label htmlFor="category-name">Name *</Label>
                <Input
                  id="category-name"
                  placeholder="e.g. Skirts"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  aria-invalid={Boolean(errors.name)}
                  autoFocus
                />
                {errors.name && <FieldError>{errors.name}</FieldError>}
              </Field>

              <Field>
                <Label htmlFor="category-parent">Inside</Label>
                <CategorySelect
                  id="category-parent"
                  categories={categories}
                  value={parentId}
                  onChange={setParentId}
                  noneLabel="Nothing — make it a top-level category"
                  disabledReason={(c) => parentProblem(categories, editing?.id ?? null, c.id)}
                />
                {errors.parentId ? (
                  <FieldError>{errors.parentId}</FieldError>
                ) : (
                  <FieldDescription>
                    Up to {MAX_CATEGORY_DEPTH} levels, e.g. Fashion › Women › Skirts. Options you can’t pick are greyed out.
                  </FieldDescription>
                )}
              </Field>
            </FormSection>

            <FormSection title="Online store" description="How this category appears to customers.">
              <label className="flex items-start gap-3 rounded-md border p-3">
                <CheckboxRoot checked={isVisible} onCheckedChange={(v) => setIsVisible(v === true)} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium text-foreground">Show in online store</span>
                  <span className="block text-xs text-muted-foreground">
                    Turn off to keep using it for stock and reports without customers seeing it. Its subcategories are hidden too.
                  </span>
                </span>
              </label>

              {isTopLevel && (
                <label className="flex items-start gap-3 rounded-md border p-3">
                  <CheckboxRoot checked={isFeatured} onCheckedChange={(v) => setIsFeatured(v === true)} className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium text-foreground">Feature in store navigation</span>
                    <span className="block text-xs text-muted-foreground">
                      Keeps it in the main menu and suggested departments even before it has products.
                    </span>
                  </span>
                </label>
              )}

              <Field>
                <Label htmlFor="category-slug">Web address</Label>
                <Input
                  id="category-slug"
                  value={effectiveSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                  aria-invalid={Boolean(errors.slug)}
                  className="font-mono text-xs"
                />
                {errors.slug ? (
                  <FieldError>{errors.slug}</FieldError>
                ) : (
                  <FieldDescription>
                    Customers will find it at <span className="font-mono text-foreground">{urlPreview}</span>
                    {editing && slug !== editing.slug && ' — changing this breaks links people have already saved.'}
                  </FieldDescription>
                )}
              </Field>

              <Field>
                <Label htmlFor="category-description">Description</Label>
                <Textarea
                  id="category-description"
                  className="h-20"
                  placeholder="One or two sentences shown at the top of the category page."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  aria-invalid={Boolean(errors.description)}
                />
                <div className="flex justify-between gap-2">
                  {errors.description ? <FieldError>{errors.description}</FieldError> : <span />}
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {description.length}/{DESCRIPTION_MAX}
                  </span>
                </div>
              </Field>

              <Field>
                <Label>Image</Label>
                <ImageUploader
                  purpose="categories"
                  max={1}
                  value={imageUrl.trim() ? [{ url: imageUrl.trim(), publicId: imageUrl.trim() }] : []}
                  onChange={(images) => setImageUrl(images[0]?.url ?? '')}
                  onBusyChange={setUploading}
                  hint={isTopLevel ? 'Used as the banner on the department page. A wide photo works best.' : 'Used as the thumbnail in menus. A square photo works best.'}
                />
                {errors.imageUrl && <FieldError>{errors.imageUrl}</FieldError>}
              </Field>
            </FormSection>

            <FormSection
              title="Goes well with"
              description="Products from these categories are suggested with anything in this one — on its product pages and in the customer’s bag."
            >
              <Field>
                <Label htmlFor="category-companions">Categories</Label>
                {companions.length > 0 && (
                  <ol className="space-y-1.5">
                    {companions.map((c, index) => (
                      <li key={c.id} className="flex items-center gap-2 rounded-md border px-3 py-1">
                        <span className="w-4 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{c.namePath.join(' › ')}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${c.name}`}
                          onClick={() => setCompanionIds((ids) => ids.filter((id) => id !== c.id))}
                        >
                          <X className="size-4" />
                        </Button>
                      </li>
                    ))}
                  </ol>
                )}
                {companions.length < MAX_COMPANIONS && (
                  <CategorySelect
                    id="category-companions"
                    categories={categories}
                    value={null}
                    onChange={(id) => id && setCompanionIds((ids) => [...ids.filter((x) => x !== id), id])}
                    noneLabel={companions.length ? 'Add another category…' : 'Add a category…'}
                    disabledReason={(c) =>
                      c.id === editing?.id ? 'This category' : companionIds.includes(c.id) ? 'Already added' : null
                    }
                  />
                )}
                <FieldDescription>
                  Up to {MAX_COMPANIONS}, most important first — e.g. Bags and Jewellery for Dresses. Leave empty and
                  we’ll suggest products from the categories next to this one.
                </FieldDescription>
              </Field>

              {companions.length > 0 && (
                <Field>
                  <Label htmlFor="category-companion-title">Row heading</Label>
                  <Input
                    id="category-companion-title"
                    placeholder="You may also need"
                    value={companionTitle}
                    onChange={(e) => setCompanionTitle(e.target.value)}
                    aria-invalid={Boolean(errors.companionTitle)}
                  />
                  {errors.companionTitle ? (
                    <FieldError>{errors.companionTitle}</FieldError>
                  ) : (
                    <FieldDescription>
                      The title customers see above these suggestions, e.g. “Complete the look” or “Finish the room”.
                    </FieldDescription>
                  )}
                </Field>
              )}
            </FormSection>
          </div>

          <SheetFooter>
            <SheetClose asChild>
              <Button type="button" variant="outline" size="sm">
                Cancel
              </Button>
            </SheetClose>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              {editing ? 'Save changes' : 'Create category'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </SheetRoot>
  );
}
