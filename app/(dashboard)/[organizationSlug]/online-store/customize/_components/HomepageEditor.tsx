'use client';

/*
 * Online store → Customize → Front page (ROADMAP 15.3).
 *
 * The shop's front page as a list: show or hide a section, move it (buttons
 * for everyone, dragging as a shortcut), give a product band its heading,
 * layout and source, add one from a short menu, remove one. Beside it, the
 * real storefront in a frame showing the saved draft.
 *
 * Like the Look tab, nothing here is live until Publish. Save draft keeps
 * the arrangement (and refreshes the preview); Publish puts the whole draft
 * — look and front page — live at once.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ExternalLink, GripVertical, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ImageUploader, type UploadedImage } from '@/components/media/image-uploader';
import { Label } from '@/components/ui/label';
import { SwitchRoot } from '@/components/ui/switch';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
} from '@/components/ui/select';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import {
  SECTION_INFO,
  SECTION_TAGS,
  classicSections,
  newSection,
  type HomepageSection,
  type SectionSource,
  type SectionType,
} from '@/lib/storefront/sections/schema';
import {
  createDesignPreviewLink,
  publishDesign,
  saveHomepageDraft,
  type DesignEditorData,
} from '@/features/storefront/design';
import { PreviewPane } from './PreviewPane';

export interface SourceOptions {
  collections: { id: string; name: string }[];
  categories: { id: string; label: string }[];
  brands: { id: string; name: string }[];
}

type ProductsSection = Extract<HomepageSection, { type: 'products' }>;
type ImageTextSection = Extract<HomepageSection, { type: 'image-text' }>;
type HeroSection = Extract<HomepageSection, { type: 'hero' }>;
type CategoriesSection = Extract<HomepageSection, { type: 'category-showcase' }>;
type Destination = { label: string; href: string };

/** Sections with something to set beyond show/hide and order. */
const EDITABLE = new Set<SectionType>(['hero', 'products', 'category-showcase', 'image-text']);

const BAND_LAYOUTS: Record<ProductsSection['variant'], string> = {
  carousel: 'Scrolling row',
  grid: 'Grid',
  feature: 'One large, then a grid',
};
const CATEGORY_LAYOUTS: Record<CategoriesSection['variant'], string> = {
  tiles: 'Big pictures',
  circles: 'Round pictures',
  list: 'Names only',
};
const HERO_LAYOUTS: Record<HeroSection['variant'], string> = {
  full: 'Words over the picture',
  split: 'Words beside the picture',
};

/** What the list says under a section's name. */
function summary(section: HomepageSection, options: SourceOptions): string {
  switch (section.type) {
    case 'products':
      return `${BAND_LAYOUTS[section.variant]} · ${sourceLabel(section.source, options)}`;
    case 'category-showcase':
      return `${CATEGORY_LAYOUTS[section.variant]} · ${SECTION_INFO[section.type].description}`;
    case 'hero':
      return `${HERO_LAYOUTS[section.variant]} when you have slides · ${SECTION_INFO.hero.description}`;
    case 'image-text':
      return [section.image ? 'With a picture' : 'Words only', section.buttonLabel && `Button: ${section.buttonLabel}`]
        .filter(Boolean)
        .join(' · ');
    default:
      return SECTION_INFO[section.type].description;
  }
}

/** The first thing stopping a save, in the merchant's words — or null. */
function problemIn(sections: HomepageSection[]): string | null {
  for (const s of sections) {
    if (s.type === 'products' && !s.title.trim()) return 'Every product band needs a heading.';
    if (s.type === 'image-text') {
      if (!s.heading.trim()) return 'Every image and text section needs a heading.';
      if (Boolean(s.buttonLabel.trim()) !== Boolean(s.buttonHref)) {
        return `The button in “${s.heading}” needs both its words and a page to go to.`;
      }
    }
  }
  return null;
}

const TAG_LABELS: Record<(typeof SECTION_TAGS)[number], string> = {
  new: 'Tagged “New”',
  featured: 'Tagged “Featured”',
  bestseller: 'Tagged “Bestseller”',
  sale: 'Tagged “On sale”',
  'deal-of-day': 'Tagged “Deal of the day”',
  trending: 'Tagged “Trending”',
  limited: 'Tagged “Limited edition”',
};

/* A source as one Select value, and back. */
function sourceKey(source: SectionSource): string {
  if (source.kind === 'bestselling' || source.kind === 'newest') return source.kind;
  if (source.kind === 'tag') return `tag:${source.tag}`;
  return `${source.kind}:${source.id}`;
}
function sourceFromKey(key: string): SectionSource {
  const at = key.indexOf(':');
  const kind = at === -1 ? key : key.slice(0, at);
  const value = at === -1 ? '' : key.slice(at + 1);
  if (kind === 'bestselling' || kind === 'newest') return { kind };
  if (kind === 'tag') return { kind, tag: value as (typeof SECTION_TAGS)[number] };
  return { kind: kind as 'collection' | 'category' | 'brand', id: value };
}

function sourceLabel(source: SectionSource, options: SourceOptions): string {
  switch (source.kind) {
    case 'bestselling':
      return 'Best sellers';
    case 'newest':
      return 'Newest first';
    case 'tag':
      return TAG_LABELS[source.tag];
    case 'collection':
      return `Collection · ${options.collections.find((c) => c.id === source.id)?.name ?? 'no longer available'}`;
    case 'category':
      return `Category · ${options.categories.find((c) => c.id === source.id)?.label ?? 'no longer available'}`;
    case 'brand':
      return `Brand · ${options.brands.find((b) => b.id === source.id)?.name ?? 'no longer available'}`;
  }
}

export function HomepageEditor({
  editor,
  options,
  destinations,
  active,
}: {
  editor: DesignEditorData;
  options: SourceOptions;
  /** real pages a button may link to — the same picker as slides and announcements */
  destinations: Destination[];
  /** the tab is open — the preview frame only loads then */
  active: boolean;
}) {
  const router = useRouter();
  const saved = React.useMemo(
    () => (editor.draft ?? editor.live).sections ?? classicSections(),
    [editor],
  );
  const [sections, setSections] = React.useState<HomepageSection[]>(saved);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<HomepageSection | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [dragging, setDragging] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState<null | 'save' | 'publish' | 'preview'>(null);
  const [error, setError] = React.useState<string | null>(null);

  const dirty = JSON.stringify(sections) !== JSON.stringify(saved);
  const hasDraft = editor.draft !== null;

  /* A save here or on the Look tab, or a publish, gives a new baseline —
   * keyed on when, so switching tabs never wipes edits in progress. */
  const savedKey = `${editor.draftSavedAt ?? ''}|${editor.publishedAt ?? ''}`;
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;
  React.useEffect(() => {
    if (!dirtyRef.current) setSections(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const problem = problemIn(sections);
  const [uploading, setUploading] = React.useState(false);

  /* ── changing the list ─────────────────────────────────────────── */

  function update(id: string, patch: Partial<Omit<HomepageSection, 'id' | 'type'>> & Record<string, unknown>) {
    setSections((list) => list.map((s) => (s.id === id ? ({ ...s, ...patch } as HomepageSection) : s)));
  }

  function moveTo(from: number, to: number) {
    // The top section stays first.
    if (from === 0 || to < 1 || to >= sections.length || from === to) return;
    setSections((list) => {
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function add(type: SectionType) {
    const section = newSection(type, sections.map((s) => s.id));
    setSections((list) => [...list, section]);
    if (EDITABLE.has(section.type)) setEditing(section.id);
  }

  function confirmRemove() {
    if (!removing) return;
    setSections((list) => list.filter((s) => s.id !== removing.id));
    setRemoving(null);
  }

  const missing = (Object.keys(SECTION_INFO) as SectionType[]).filter(
    (type) => type !== 'hero' && (!SECTION_INFO[type].single || !sections.some((s) => s.type === type)),
  );

  /* ── saving ────────────────────────────────────────────────────── */

  async function save(): Promise<string | null> {
    if (problem) {
      setError(problem);
      return null;
    }
    if (uploading) {
      setError('Wait for the picture to finish uploading.');
      return null;
    }
    setError(null);
    const result = await saveHomepageDraft(sections);
    if (!result.success) {
      setError(result.error);
      return null;
    }
    return result.data.draftSavedAt;
  }

  async function onSave() {
    setBusy('save');
    const savedAt = await save();
    setBusy(null);
    if (savedAt) {
      toast.success('Draft saved — the preview shows it; shoppers won’t until you publish');
      router.refresh();
    }
  }

  async function onPublish() {
    setBusy('publish');
    const savedAt = dirty || !editor.draftSavedAt ? await save() : editor.draftSavedAt;
    if (!savedAt) {
      setBusy(null);
      return;
    }
    const result = await publishDesign(savedAt);
    setBusy(null);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success('Published — your front page is live');
    router.refresh();
  }

  /* Small screens have no room for the frame: preview in a new tab. */
  async function onPreviewTab() {
    const tab = window.open('', '_blank');
    setBusy('preview');
    const savedAt = dirty ? await save() : 'unchanged';
    const link = savedAt ? await createDesignPreviewLink() : null;
    setBusy(null);
    if (!link?.success) {
      tab?.close();
      if (link) setError(link.error);
      return;
    }
    if (dirty) router.refresh();
    if (tab) {
      tab.opener = null;
      tab.location.href = link.data.url;
    } else window.location.href = link.data.url;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Front page sections</h2>
            <p className="text-xs text-muted-foreground">Top to bottom, as shoppers scroll.</p>
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>
              Start over
            </Button>
            <DropdownMenuRoot>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <Plus className="size-3.5" />
                  Add a section
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {missing.map((type) => (
                  <DropdownMenuItem key={type} onSelect={() => add(type)} className="flex-col items-start gap-0.5">
                    <span className="text-sm font-medium">{SECTION_INFO[type].label}</span>
                    <span className="text-xs text-muted-foreground">{SECTION_INFO[type].description}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenuRoot>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <ol className="divide-y rounded-lg border bg-card">
          {sections.map((section, index) => {
            const info = SECTION_INFO[section.type];
            const fixed = section.type === 'hero';
            const label =
              section.type === 'products'
                ? section.title || 'Untitled band'
                : section.type === 'image-text'
                  ? section.heading || 'Image and text (no heading yet)'
                  : info.label;
            const editButton = EDITABLE.has(section.type) && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Edit “${label}”`}
                aria-expanded={editing === section.id}
                onClick={() => setEditing(editing === section.id ? null : section.id)}
              >
                <Pencil className="size-3.5" />
              </Button>
            );
            return (
              <li
                key={section.id}
                draggable={!fixed}
                onDragStart={() => setDragging(index)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(event) => {
                  if (dragging !== null && !fixed) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragging !== null) moveTo(dragging, index);
                  setDragging(null);
                }}
                className={cn('px-3 py-2.5', dragging === index && 'opacity-50', !section.enabled && 'bg-muted/40')}
              >
                <div className="flex items-start gap-2">
                  <GripVertical
                    aria-hidden
                    className={cn('mt-1 size-4 shrink-0 text-muted-foreground', fixed ? 'invisible' : 'cursor-grab')}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{label}</span>
                      {fixed && <Badge variant="muted">Always first</Badge>}
                      {!section.enabled && <Badge variant="muted">Hidden</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">{summary(section, options)}</p>
                  </div>

                  {fixed && editButton}
                  {!fixed && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <SwitchRoot
                        checked={section.enabled}
                        onCheckedChange={(enabled) => update(section.id, { enabled })}
                        aria-label={`Show “${label}”`}
                        className="mr-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Move “${label}” up`}
                        disabled={index <= 1}
                        onClick={() => moveTo(index, index - 1)}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Move “${label}” down`}
                        disabled={index === sections.length - 1}
                        onClick={() => moveTo(index, index + 1)}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      {editButton}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        aria-label={`Remove “${label}”`}
                        onClick={() => setRemoving(section)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </div>

                {editing === section.id && section.type === 'products' && (
                  <BandForm section={section} options={options} onChange={(patch) => update(section.id, patch)} />
                )}
                {editing === section.id && section.type === 'hero' && (
                  <LayoutForm
                    id={section.id}
                    label="Slide layout"
                    value={section.variant}
                    choices={HERO_LAYOUTS}
                    hint="Only applies when you have slides (Slides tab). Without any, this is your search and guided browsing."
                    onChange={(variant) => update(section.id, { variant })}
                  />
                )}
                {editing === section.id && section.type === 'category-showcase' && (
                  <LayoutForm
                    id={section.id}
                    label="Layout"
                    value={section.variant}
                    choices={CATEGORY_LAYOUTS}
                    hint="Shows the categories you marked as featured."
                    onChange={(variant) => update(section.id, { variant })}
                  />
                )}
                {editing === section.id && section.type === 'image-text' && (
                  <ImageTextForm
                    section={section}
                    destinations={destinations}
                    onChange={(patch) => update(section.id, patch)}
                    onBusyChange={setUploading}
                  />
                )}
              </li>
            );
          })}
        </ol>

        <p className="text-xs text-muted-foreground">
          A band with nothing in it — an empty collection, a tag no product has — isn’t shown to shoppers.
        </p>

        <Button type="button" variant="outline" size="sm" className="lg:hidden" onClick={onPreviewTab} disabled={busy !== null}>
          {busy === 'preview' ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
          Preview in a new tab
        </Button>
      </div>

      <div className="hidden lg:sticky lg:top-4 lg:block">
        {active && <PreviewPane reloadKey={savedKey} dirty={dirty} />}
      </div>

      {/* ── Save, publish ─────────────────────────────────────────── */}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:col-span-2">
        <p className="text-sm text-muted-foreground">
          {dirty
            ? 'You have unsaved changes.'
            : hasDraft
              ? 'Your draft is saved but not live.'
              : 'Nothing to publish — this is your live front page.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setSections(saved)} disabled={busy !== null}>
              Undo changes
            </Button>
          )}
          {dirty && (
            <Button type="button" variant="outline" size="sm" onClick={onSave} disabled={busy !== null}>
              {busy === 'save' && <Loader2 className="size-3.5 animate-spin" />}
              Save draft
            </Button>
          )}
          <Button type="button" size="sm" onClick={onPublish} disabled={busy !== null || (!dirty && !hasDraft)}>
            {busy === 'publish' && <Loader2 className="size-3.5 animate-spin" />}
            Publish
          </Button>
        </div>
      </div>

      <AlertDialogRoot open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this section?</AlertDialogTitle>
            <AlertDialogDescription>
              It comes off your draft front page. Your live shop doesn’t change until you publish, and you can add
              it back from “Add a section”. To keep it but not show it, turn it off instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmRemove}>
              Remove section
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>

      <AlertDialogRoot open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start over with the standard front page?</AlertDialogTitle>
            <AlertDialogDescription>
              Your sections go back to the standard set and order, and bands you added are removed. Nothing changes
              for shoppers until you save and publish.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep mine</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                setSections(classicSections());
                setEditing(null);
                setConfirmReset(false);
              }}
            >
              Start over
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </div>
  );
}

/* ─── A product band's heading, layout and source ────────────────────── */

function BandForm({
  section,
  options,
  onChange,
}: {
  section: ProductsSection;
  options: SourceOptions;
  onChange: (patch: Partial<ProductsSection>) => void;
}) {
  const titleId = `band-title-${section.id}`;
  return (
    <div className="mt-3 grid gap-3 rounded-md border bg-background p-3">
      <Field>
        <Label htmlFor={titleId}>
          Heading <span className="text-destructive">*</span>
        </Label>
        <Input
          id={titleId}
          value={section.title}
          maxLength={60}
          onChange={(event) => onChange({ title: event.target.value })}
          aria-invalid={!section.title.trim()}
        />
        {!section.title.trim() && <FieldError>Give the band a heading</FieldError>}
      </Field>

      <Field>
        <Label htmlFor={`band-source-${section.id}`}>Products from</Label>
        <SelectRoot value={sourceKey(section.source)} onValueChange={(key) => onChange({ source: sourceFromKey(key) })}>
          <SelectTrigger id={`band-source-${section.id}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Worked out for you</SelectLabel>
              <SelectItem value="bestselling">Best sellers</SelectItem>
              <SelectItem value="newest">Newest first</SelectItem>
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Your tags</SelectLabel>
              {SECTION_TAGS.map((tag) => (
                <SelectItem key={tag} value={`tag:${tag}`}>
                  {TAG_LABELS[tag]}
                </SelectItem>
              ))}
            </SelectGroup>
            {options.collections.length > 0 && (
              <SelectGroup>
                <SelectLabel>Collections</SelectLabel>
                {options.collections.map((c) => (
                  <SelectItem key={c.id} value={`collection:${c.id}`}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {options.categories.length > 0 && (
              <SelectGroup>
                <SelectLabel>Categories</SelectLabel>
                {options.categories.map((c) => (
                  <SelectItem key={c.id} value={`category:${c.id}`}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {options.brands.length > 0 && (
              <SelectGroup>
                <SelectLabel>Brands</SelectLabel>
                {options.brands.map((b) => (
                  <SelectItem key={b.id} value={`brand:${b.id}`}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </SelectRoot>
      </Field>

      <Field>
        <Label htmlFor={`band-layout-${section.id}`}>Layout</Label>
        <SelectRoot
          value={section.variant}
          onValueChange={(variant) => onChange({ variant: variant as ProductsSection['variant'] })}
        >
          <SelectTrigger id={`band-layout-${section.id}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(BAND_LAYOUTS) as ProductsSection['variant'][]).map((key) => (
              <SelectItem key={key} value={key}>
                {BAND_LAYOUTS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
      </Field>
    </div>
  );
}

/* ─── A section's layout ─────────────────────────────────────────────── */

function LayoutForm<K extends string>({
  id,
  label,
  value,
  choices,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  value: K;
  choices: Record<K, string>;
  hint: string;
  onChange: (value: K) => void;
}) {
  return (
    <div className="mt-3 rounded-md border bg-background p-3">
      <Field>
        <Label htmlFor={`layout-${id}`}>{label}</Label>
        <SelectRoot value={value} onValueChange={(next) => onChange(next as K)}>
          <SelectTrigger id={`layout-${id}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(choices) as K[]).map((key) => (
              <SelectItem key={key} value={key}>
                {choices[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
        <FieldDescription>{hint}</FieldDescription>
      </Field>
    </div>
  );
}

/* ─── A picture and the merchant's own words ─────────────────────────── */

const NO_BUTTON = '__none';

function ImageTextForm({
  section,
  destinations,
  onChange,
  onBusyChange,
}: {
  section: ImageTextSection;
  destinations: Destination[];
  onChange: (patch: Partial<ImageTextSection>) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const id = section.id;
  const image: UploadedImage[] = section.image ? [section.image] : [];
  const buttonProblem = Boolean(section.buttonLabel.trim()) !== Boolean(section.buttonHref);
  return (
    <div className="mt-3 grid gap-3 rounded-md border bg-background p-3">
      <Field>
        <Label htmlFor={`it-heading-${id}`}>
          Heading <span className="text-destructive">*</span>
        </Label>
        <Input
          id={`it-heading-${id}`}
          value={section.heading}
          maxLength={80}
          placeholder="e.g. Made by hand in Abeokuta"
          onChange={(event) => onChange({ heading: event.target.value })}
          aria-invalid={!section.heading.trim()}
        />
        {!section.heading.trim() && <FieldError>Give the section a heading</FieldError>}
      </Field>

      <Field>
        <Label htmlFor={`it-body-${id}`}>Words</Label>
        <Textarea
          id={`it-body-${id}`}
          value={section.body}
          maxLength={600}
          rows={4}
          onChange={(event) => onChange({ body: event.target.value })}
        />
        <FieldDescription>{600 - section.body.length} characters left. Plain text; line breaks are kept.</FieldDescription>
      </Field>

      <Field>
        <Label>Picture</Label>
        <ImageUploader
          purpose="storefront"
          value={image}
          onChange={(next) => onChange({ image: next[0] ? { url: next[0].url, publicId: next[0].publicId } : null })}
          max={1}
          onBusyChange={onBusyChange}
          hint="PNG, JPG or WebP, up to 10MB. Without one, the words sit centred on their own."
        />
      </Field>

      {section.image && (
        <Field>
          <Label htmlFor={`it-side-${id}`}>Picture on the</Label>
          <SelectRoot value={section.imageSide} onValueChange={(side) => onChange({ imageSide: side as 'left' | 'right' })}>
            <SelectTrigger id={`it-side-${id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="left">Left</SelectItem>
              <SelectItem value="right">Right</SelectItem>
            </SelectContent>
          </SelectRoot>
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <Label htmlFor={`it-btn-${id}`}>Button words</Label>
          <Input
            id={`it-btn-${id}`}
            value={section.buttonLabel}
            maxLength={40}
            placeholder="e.g. Read our story"
            onChange={(event) => onChange({ buttonLabel: event.target.value })}
          />
        </Field>
        <Field>
          <Label htmlFor={`it-href-${id}`}>Goes to</Label>
          <SelectRoot
            value={section.buttonHref || NO_BUTTON}
            onValueChange={(href) => onChange({ buttonHref: href === NO_BUTTON ? '' : href })}
          >
            <SelectTrigger id={`it-href-${id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_BUTTON}>No button</SelectItem>
              {destinations.map((d) => (
                <SelectItem key={d.href} value={d.href}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
        </Field>
      </div>
      {buttonProblem && <FieldError>A button needs both its words and a page to go to.</FieldError>}
    </div>
  );
}
