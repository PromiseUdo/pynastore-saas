'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldDescription, FieldError, FormSection } from '@/components/ui/form-field';
import { SheetRoot, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription, SheetClose } from '@/components/ui/sheet';
import { ImageUploader } from '@/components/media/image-uploader';
import { SLUG_PATTERN, slugify } from '@/features/inventory/category-tree';
import { saveBrand, type BrandRow } from '@/features/inventory/actions';

const DESCRIPTION_MAX = 500;

type BrandSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: BrandRow | null;
};

export function BrandSheet({ open, onOpenChange, editing }: BrandSheetProps) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [description, setDescription] = React.useState('');
  const [logo, setLogo] = React.useState<{ url: string; publicId: string }[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [errors, setErrors] = React.useState<{ name?: string; slug?: string }>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setSlug(editing?.slug ?? '');
    setSlugTouched(Boolean(editing));
    setDescription(editing?.description ?? '');
    setLogo(editing?.logoUrl ? [{ url: editing.logoUrl, publicId: editing.logoPublicId ?? editing.logoUrl }] : []);
    setErrors({});
    setFormError(null);
  }, [open, editing]);

  const effectiveSlug = slugTouched ? slug.trim() : name.trim() ? slugify(name) : '';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const found: typeof errors = {};
    if (!name.trim()) found.name = 'Give the brand a name.';
    if (effectiveSlug && !SLUG_PATTERN.test(effectiveSlug)) found.slug = 'Use lowercase letters, numbers and single hyphens only.';
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length) return;
    if (uploading) {
      setFormError('Wait for the logo to finish uploading.');
      return;
    }

    setPending(true);
    const result = await saveBrand(editing?.id ?? null, {
      name: name.trim(),
      slug: slugTouched ? slug.trim() : '',
      description: description.trim(),
      logo: logo[0] ?? null,
    });
    setPending(false);
    if (!result.success) {
      setFormError(result.error);
      return;
    }
    toast.success(editing ? `Saved “${name.trim()}”` : `Added “${name.trim()}”`);
    router.refresh();
    onOpenChange(false);
  }

  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <SheetHeader>
            <SheetTitle>{editing ? `Edit “${editing.name}”` : 'New brand'}</SheetTitle>
            <SheetDescription>Brands let customers shop by maker, and filter your products by it.</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-8 overflow-y-auto px-6 py-5">
            {formError && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            )}

            <FormSection title="Details">
              <Field>
                <Label htmlFor="brand-name">Name *</Label>
                <Input
                  id="brand-name"
                  autoFocus
                  placeholder="e.g. Aurora & Co"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-invalid={Boolean(errors.name)}
                />
                {errors.name && <FieldError>{errors.name}</FieldError>}
              </Field>

              <Field>
                <Label htmlFor="brand-desc">Description</Label>
                <Textarea
                  id="brand-desc"
                  className="h-24"
                  maxLength={DESCRIPTION_MAX}
                  placeholder="A sentence or two about the brand, shown on its page."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <FieldDescription>
                  {description.length}/{DESCRIPTION_MAX}
                </FieldDescription>
              </Field>
            </FormSection>

            <FormSection title="Online store">
              <Field>
                <Label>Logo</Label>
                <ImageUploader
                  purpose="brands"
                  max={1}
                  value={logo}
                  onChange={(images) => setLogo(images.map((i) => ({ url: i.url, publicId: i.publicId })))}
                  onBusyChange={setUploading}
                  hint="A square logo on a plain background works best."
                />
              </Field>

              <Field>
                <Label htmlFor="brand-slug">Web address</Label>
                <Input
                  id="brand-slug"
                  className="font-mono text-xs"
                  value={effectiveSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                  aria-invalid={Boolean(errors.slug)}
                />
                {errors.slug ? (
                  <FieldError>{errors.slug}</FieldError>
                ) : (
                  <FieldDescription>
                    Customers will find it at <span className="font-mono text-foreground">/brands/{effectiveSlug || '…'}</span>
                  </FieldDescription>
                )}
              </Field>
            </FormSection>
          </div>

          <SheetFooter>
            <SheetClose asChild>
              <Button type="button" variant="outline" size="sm">
                Cancel
              </Button>
            </SheetClose>
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              {editing ? 'Save changes' : 'Add brand'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </SheetRoot>
  );
}
