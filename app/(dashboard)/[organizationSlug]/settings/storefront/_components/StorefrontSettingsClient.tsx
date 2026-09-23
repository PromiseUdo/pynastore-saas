'use client';

/*
 * Settings → Storefront.
 *
 * Three things a merchant wants from their own shop's front page: something
 * of their own at the top of it, their colour on the buttons, and a decent
 * showing when someone shares the link.
 *
 * Nothing here has a default sentence. Leaving a field empty gives the
 * storefront's own behaviour, not a line written on the merchant's behalf.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ExternalLink, Images, Loader2, Palette, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SwitchRoot } from '@/components/ui/switch';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { ImageUploader, type UploadedImage } from '@/components/media/image-uploader';
import { cn } from '@/lib/utils';
import { isHexColour } from '@/lib/marketing/announcement';
import {
  deleteHeroSlide,
  reorderHeroSlides,
  saveHeroSlide,
  saveStorefrontAppearance,
  type HeroSlideRow,
  type StorefrontAppearance,
} from '@/features/settings/storefront';

type Destination = { label: string; href: string };

export function StorefrontSettingsClient({
  appearance,
  slides,
  destinations,
  storeUrl,
  canManage,
}: {
  appearance: StorefrontAppearance;
  slides: HeroSlideRow[];
  destinations: Destination[];
  storeUrl: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<HeroSlideRow | 'new' | null>(null);
  const [removing, setRemoving] = React.useState<HeroSlideRow | null>(null);
  const [pending, setPending] = React.useState(false);

  async function move(slide: HeroSlideRow, direction: -1 | 1) {
    const order = slides.map((s) => s.id);
    const from = order.indexOf(slide.id);
    const to = from + direction;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];

    const result = await reorderHeroSlides(order);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  async function confirmRemove() {
    if (!removing) return;
    setPending(true);
    const result = await deleteHeroSlide(removing.id);
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Slide removed');
    setRemoving(null);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Storefront"
        description="How your online shop looks, and how it appears when someone shares the link."
        actions={
          <Button variant="outline" size="sm" asChild>
            <a href={storeUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              Visit your store
            </a>
          </Button>
        }
      />

      <PageBody className="max-w-4xl space-y-6">
        {/* ── The top of the homepage ─────────────────────────────── */}
        <section className="rounded-lg border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Images className="size-4" aria-hidden />
                Front page slides
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                The first thing customers see. Several rotate slowly; one just sits there.
              </p>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus className="size-3.5" />
                Add a slide
              </Button>
            )}
          </div>

          {slides.length === 0 ? (
            <EmptyState
              icon={Images}
              title="No slides yet"
              description="Without any, your shop opens straight into the search and browsing sections — which works. A slide is for when you have something to say: a new arrival, a sale, a story."
              action={canManage ? <Button onClick={() => setEditing('new')}>Add your first slide</Button> : undefined}
            />
          ) : (
            <ul className="divide-y">
              {slides.map((slide, index) => (
                <li key={slide.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="size-14 shrink-0 overflow-hidden rounded-md bg-muted">
                    {slide.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={slide.imageUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="flex size-full items-center justify-center text-[10px] text-muted-foreground">
                        No image
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {slide.title}
                      {!slide.isVisible && <Badge variant="muted">Hidden</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {slide.subtitle || 'No subtitle'}
                      {slide.ctaLabel && slide.ctaHref ? ` · ${slide.ctaLabel} → ${slide.ctaHref}` : ''}
                    </p>
                  </div>

                  {canManage && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move ${slide.title} up`}
                        disabled={index === 0}
                        onClick={() => move(slide, -1)}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move ${slide.title} down`}
                        disabled={index === slides.length - 1}
                        onClick={() => move(slide, 1)}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setEditing(slide)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${slide.title}`}
                        onClick={() => setRemoving(slide)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <AppearanceSection appearance={appearance} canManage={canManage} />
      </PageBody>

      {editing && (
        <SlideEditor
          slide={editing === 'new' ? null : editing}
          destinations={destinations}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      <AlertDialogRoot open={removing !== null} onOpenChange={(next) => !next && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{removing?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It comes off your shop straight away, and its picture is deleted. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmRemove} disabled={pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Remove slide
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </>
  );
}

/* ─── Colour, and how the link looks when shared ─────────────────────── */

function AppearanceSection({
  appearance,
  canManage,
}: {
  appearance: StorefrontAppearance;
  canManage: boolean;
}) {
  const router = useRouter();
  const [accent, setAccent] = React.useState(appearance.accent ?? '');
  const [tagline, setTagline] = React.useState(appearance.tagline ?? '');
  const [gaId, setGaId] = React.useState(appearance.gaId ?? '');
  const [metaPixelId, setMetaPixelId] = React.useState(appearance.metaPixelId ?? '');
  const [socialImage, setSocialImage] = React.useState<UploadedImage[]>(
    appearance.socialImageUrl && appearance.socialImagePublicId
      ? [{ url: appearance.socialImageUrl, publicId: appearance.socialImagePublicId }]
      : [],
  );
  const [uploading, setUploading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const accentProblem = accent.trim() && !isHexColour(accent) ? 'Use a colour like #b42318' : null;

  async function save() {
    if (accentProblem) {
      setError(accentProblem);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await saveStorefrontAppearance({
      accent,
      tagline,
      socialImage: socialImage[0] ? { url: socialImage[0].url, publicId: socialImage[0].publicId } : null,
      gaId,
      metaPixelId,
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success('Storefront settings saved');
    router.refresh();
  }

  return (
    <>
      <section className="space-y-4 rounded-lg border bg-card p-4">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Palette className="size-4" aria-hidden />
            Colour
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Used for buttons and highlights on your shop. Leave it empty to keep the default.
          </p>
        </div>

        <Field>
          <Label htmlFor="accent">Brand colour</Label>
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              style={{ backgroundColor: isHexColour(accent) ? accent : undefined }}
              className={cn('size-9 shrink-0 rounded-md border', !isHexColour(accent) && 'bg-primary')}
            />
            <Input
              id="accent"
              value={accent}
              onChange={(event) => setAccent(event.target.value)}
              disabled={!canManage}
              placeholder="#b42318"
              className="font-mono text-xs"
              aria-invalid={Boolean(accentProblem)}
            />
          </div>
          {accentProblem && <FieldError>{accentProblem}</FieldError>}
        </Field>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-4">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Search className="size-4" aria-hidden />
            Search results and shared links
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            What people see on Google, and when your shop is shared on WhatsApp or Instagram.
          </p>
        </div>

        <Field>
          <Label htmlFor="tagline">One line about your shop</Label>
          <Textarea
            id="tagline"
            value={tagline}
            onChange={(event) => setTagline(event.target.value)}
            disabled={!canManage}
            rows={2}
            maxLength={200}
            placeholder="e.g. Hand-dyed adire and ready-to-wear, made in Abeokuta and delivered nationwide."
          />
          <FieldDescription>
            {200 - tagline.length} characters left. This is never shown on your shop itself.
          </FieldDescription>
        </Field>

        <Field>
          <Label>Share picture</Label>
          <FieldDescription>
            Shown when someone pastes a link to your shop. Wide works best. Without one we use your logo.
          </FieldDescription>
          <ImageUploader
            purpose="storefront"
            value={socialImage}
            onChange={setSocialImage}
            max={1}
            disabled={!canManage}
            onBusyChange={setUploading}
            hint="PNG, JPG or WebP, up to 10MB"
          />
        </Field>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold">Tracking</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Paste in ids from your own accounts. Nothing is loaded on your shop unless you fill these in.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <Label htmlFor="ga">Google Analytics</Label>
            <Input
              id="ga"
              value={gaId}
              onChange={(event) => setGaId(event.target.value)}
              disabled={!canManage}
              placeholder="G-XXXXXXXXXX"
              className="font-mono text-xs"
            />
          </Field>
          <Field>
            <Label htmlFor="pixel">Meta pixel</Label>
            <Input
              id="pixel"
              value={metaPixelId}
              onChange={(event) => setMetaPixelId(event.target.value)}
              disabled={!canManage}
              placeholder="1234567890123456"
              className="font-mono text-xs"
            />
          </Field>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {canManage && (
          <Button size="sm" onClick={save} disabled={saving || uploading}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Save storefront settings
          </Button>
        )}
      </section>
    </>
  );
}

/* ─── One slide ──────────────────────────────────────────────────────── */

/** Mirrors `scrim()` in the storefront's hero, so the preview can't lie. */
function previewScrim(dark: boolean, align: string): string {
  if (align === 'CENTER') return dark ? 'bg-black/50' : 'bg-white/60';
  const direction = align === 'RIGHT' ? 'bg-gradient-to-l' : 'bg-gradient-to-r';
  return dark
    ? `${direction} from-black/70 via-black/40 to-transparent`
    : `${direction} from-white/80 via-white/50 to-transparent`;
}

function SlideEditor({
  slide,
  destinations,
  onClose,
  onSaved,
}: {
  slide: HeroSlideRow | null;
  destinations: Destination[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [eyebrow, setEyebrow] = React.useState(slide?.eyebrow ?? '');
  const [title, setTitle] = React.useState(slide?.title ?? '');
  const [subtitle, setSubtitle] = React.useState(slide?.subtitle ?? '');
  const [ctaLabel, setCtaLabel] = React.useState(slide?.ctaLabel ?? '');
  const [ctaHref, setCtaHref] = React.useState(slide?.ctaHref ?? '');
  const [align, setAlign] = React.useState(slide?.align ?? 'LEFT');
  const [theme, setTheme] = React.useState(slide?.theme ?? 'DARK');
  const [isVisible, setIsVisible] = React.useState(slide?.isVisible ?? true);
  const [image, setImage] = React.useState<UploadedImage[]>(
    slide?.imageUrl && slide.imagePublicId ? [{ url: slide.imageUrl, publicId: slide.imagePublicId }] : [],
  );
  const [uploading, setUploading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    if (title.trim().length < 2) {
      setError('Give the slide a headline');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await saveHeroSlide(slide?.id ?? null, {
      eyebrow,
      title,
      subtitle,
      ctaLabel,
      ctaHref,
      image: image[0] ? { url: image[0].url, publicId: image[0].publicId } : null,
      align: align as 'LEFT',
      theme: theme as 'DARK',
      isVisible,
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success(slide ? 'Slide updated' : 'Slide added');
    onSaved();
  }

  const dark = theme === 'DARK';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="w-full max-w-3xl rounded-lg border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{slide ? 'Edit slide' : 'New slide'}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>

        <div className="grid gap-6 p-4 lg:grid-cols-2">
          <div className="space-y-4">
            <Field>
              <Label htmlFor="slide-eyebrow">Small line above</Label>
              <Input
                id="slide-eyebrow"
                value={eyebrow}
                onChange={(event) => setEyebrow(event.target.value)}
                placeholder="New in"
                maxLength={40}
              />
            </Field>

            <Field>
              <Label htmlFor="slide-title">
                Headline <span className="text-destructive">*</span>
              </Label>
              <Input
                id="slide-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="The rainy season edit"
                maxLength={80}
              />
            </Field>

            <Field>
              <Label htmlFor="slide-subtitle">A line underneath</Label>
              <Textarea
                id="slide-subtitle"
                value={subtitle}
                onChange={(event) => setSubtitle(event.target.value)}
                rows={2}
                maxLength={160}
                placeholder="Water-resistant pieces, made for Lagos weather."
              />
            </Field>

            <Field>
              <Label>Picture</Label>
              <FieldDescription>Wide works best. Without one the slide is a plain panel.</FieldDescription>
              <ImageUploader
                purpose="storefront"
                value={image}
                onChange={setImage}
                max={1}
                onBusyChange={setUploading}
                hint="PNG, JPG or WebP, up to 10MB"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <Label htmlFor="slide-cta">Button</Label>
                <Input
                  id="slide-cta"
                  value={ctaLabel}
                  onChange={(event) => setCtaLabel(event.target.value)}
                  placeholder="Shop the edit"
                  maxLength={40}
                />
              </Field>
              <Field>
                <Label htmlFor="slide-href">Where it goes</Label>
                <SelectRoot
                  value={ctaHref || 'none'}
                  onValueChange={(value) => setCtaHref(value === 'none' ? '' : value)}
                >
                  <SelectTrigger id="slide-href">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nowhere</SelectItem>
                    {destinations.map((destination) => (
                      <SelectItem key={destination.href} value={destination.href}>
                        {destination.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <Label htmlFor="slide-align">Words sit</Label>
                <SelectRoot value={align} onValueChange={setAlign}>
                  <SelectTrigger id="slide-align">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LEFT">Left</SelectItem>
                    <SelectItem value="CENTER">Centre</SelectItem>
                    <SelectItem value="RIGHT">Right</SelectItem>
                  </SelectContent>
                </SelectRoot>
              </Field>
              <Field>
                <Label htmlFor="slide-theme">Text colour</Label>
                <SelectRoot value={theme} onValueChange={setTheme}>
                  <SelectTrigger id="slide-theme">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DARK">Light text — for dark or busy pictures</SelectItem>
                    <SelectItem value="LIGHT">Dark text — for pale pictures</SelectItem>
                  </SelectContent>
                </SelectRoot>
                <FieldDescription>
                  We shade the picture behind the words either way, so they stay readable.
                </FieldDescription>
              </Field>
            </div>

            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                <span className="font-medium">Show it on the shop</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Turn it off to keep the slide without publishing it.
                </span>
              </span>
              <SwitchRoot checked={isVisible} onCheckedChange={setIsVisible} aria-label="Show it on the shop" />
            </label>
          </div>

          {/* What it will look like */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">On your shop</p>
            <div className="overflow-hidden rounded-lg border">
              <div className={cn('relative aspect-[21/9] w-full', dark ? 'bg-neutral-900' : 'bg-neutral-100')}>
                {image[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image[0].url} alt="" className="size-full object-cover" />
                )}
                {/* The same wash the storefront uses, running from whichever
                  * side the words are on — otherwise the preview would lie
                  * about whether they are readable. */}
                <div className={cn('absolute inset-0', image[0] && previewScrim(dark, align))} />
                <div
                  className={cn(
                    'absolute inset-0 flex items-center px-5',
                    align === 'CENTER' && 'justify-center text-center',
                    align === 'RIGHT' && 'justify-end text-right',
                  )}
                >
                  <div className={cn('max-w-[60%]', dark ? 'text-white' : 'text-neutral-900')}>
                    {eyebrow && (
                      <p className="text-[9px] font-semibold uppercase tracking-[0.2em] opacity-80">{eyebrow}</p>
                    )}
                    <p className="mt-1 text-base font-semibold leading-tight">{title || 'Your headline'}</p>
                    {subtitle && <p className="mt-1 text-[10px] leading-snug opacity-90">{subtitle}</p>}
                    {ctaLabel && ctaHref && (
                      <span
                        className={cn(
                          'mt-2 inline-flex h-6 items-center rounded-full px-3 text-[10px] font-semibold',
                          dark ? 'bg-white text-neutral-900' : 'bg-neutral-900 text-white',
                        )}
                      >
                        {ctaLabel}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {ctaLabel && !ctaHref && (
              <p className="text-xs text-amber-700 dark:text-amber-500">
                The button needs somewhere to go, or it won’t be shown.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          {error && <p className="mr-auto text-xs text-destructive">{error}</p>}
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || uploading}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {slide ? 'Save slide' : 'Add slide'}
          </Button>
        </div>
      </div>
    </div>
  );
}
