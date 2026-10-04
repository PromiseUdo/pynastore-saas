'use client';

/*
 * Online store → Customize → Look (ROADMAP 15.1).
 *
 * Two decisions, in order: pick a look, pick a colour. Light or dark first
 * is a switch. Fine-tune — corners, headings font, product cards — is folded
 * away, because most shops never need it.
 *
 * Nothing here touches the live shop until Publish:
 *   edit → Save draft → Preview (a new tab, only you see it) → Publish
 * Publish with unsaved edits saves them first, so what goes live is what is
 * on screen.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Eye, Loader2, Palette, SlidersHorizontal, SunMoon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SwitchRoot } from '@/components/ui/switch';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { RadioGroup, RadioGroupCard } from '@/components/ui/radio-group';
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
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  CARDS,
  CARD_KEYS,
  CORNERS,
  CORNER_KEYS,
  FONTS,
  FONT_KEYS,
  LOOKS,
  LOOK_KEYS,
  type LookKey,
} from '@/lib/storefront/design/looks';
import { checkBrandColour, isHex } from '@/lib/storefront/design/colour';
import { DESIGN_VERSION, sameLook, type StorefrontDesignConfig } from '@/lib/storefront/design/schema';
import {
  createDesignPreviewLink,
  discardDesignDraft,
  applyStartingLookToDraft,
  publishDesign,
  saveDesignDraft,
  type DesignEditorData,
} from '@/features/storefront/design';
import {
  STARTING_LOOKS,
  STARTING_LOOK_IDS,
  startingLookStatus,
  type StartingLookId,
  type StartingLookStatus,
} from '@/lib/storefront/design/starting-looks';

/** "Fashion and beauty", "Fashion and beauty, changed since", or "your own design". */
function describeStart(status: StartingLookStatus | null): string {
  if (!status) return 'your own design';
  return `${STARTING_LOOKS[status.id].label}${status.changed ? ', changed since' : ''}`;
}

/** The editor's working copy: a whole design minus its version. Sections pass through untouched here. */
type DesignInput = Omit<StorefrontDesignConfig, 'version'>;

const LOOKS_OWN = 'look';

function toInput(design: StorefrontDesignConfig): DesignInput {
  const { version: _version, ...rest } = design;
  return rest;
}

export function LookEditor({ editor }: { editor: DesignEditorData }) {
  const router = useRouter();
  const saved = editor.draft ?? editor.live;

  const [design, setDesign] = React.useState<DesignInput>(() => toInput(saved));
  const [colourText, setColourText] = React.useState(saved.brandColour ?? '');
  const [busy, setBusy] = React.useState<null | 'save' | 'publish' | 'preview' | 'discard'>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);

  // A fresh server copy (after save, publish or discard) becomes the baseline.
  /* A fresh server copy (after a save, publish or discard — here or on the
   * Front page tab) becomes the baseline. Keyed on WHEN it was saved, not on
   * the object: switching tabs re-renders the page with equal data, and that
   * must not wipe edits in progress. */
  const savedKey = `${editor.draftSavedAt ?? ''}|${editor.publishedAt ?? ''}`;
  const dirtyRef = React.useRef(false);
  /* Set when a starting look is applied: the look it brings replaces any
   * edits on this tab, so the next baseline is taken whatever was typed. */
  const takeNextBaseline = React.useRef(false);
  React.useEffect(() => {
    // Unsaved look edits survive a save made on the other tab.
    if (dirtyRef.current && !takeNextBaseline.current) {
      setDesign((current) => ({ ...current, sections: saved.sections, header: saved.header, footer: saved.footer }));
      return;
    }
    takeNextBaseline.current = false;
    setDesign(toInput(saved));
    setColourText(saved.brandColour ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  // Only the look counts here; the front page has its own tab and its own save.
  const dirty = !sameLook({ ...design, version: DESIGN_VERSION }, saved);
  dirtyRef.current = dirty;
  const hasDraft = editor.draft !== null;

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof DesignInput>(key: K, value: DesignInput[K]) =>
    setDesign((current) => ({ ...current, [key]: value }));

  /* The colour box is checked as the merchant types, with the same rule the
   * server applies — against the look they've picked. */
  const typed = colourText.trim().toLowerCase();
  const colourCheck = typed && isHex(typed) ? checkBrandColour(typed, LOOKS[design.look].background, LOOKS[design.look].darkBackground) : null;
  const colourProblem =
    typed && !isHex(typed)
      ? 'Use a colour like #b42318'
      : colourCheck && !colourCheck.ok
        ? colourCheck.error
        : null;

  function changeColour(value: string) {
    setColourText(value);
    const next = value.trim().toLowerCase();
    set('brandColour', next === '' ? null : isHex(next) ? next : design.brandColour);
  }

  async function saveDraft(): Promise<string | null> {
    if (colourProblem) {
      setError(colourProblem);
      return null;
    }
    setError(null);
    // Only the look: the front page, header and footer belong to their own tabs.
    const { sections: _sections, header: _header, footer: _footer, startingLook: _start, ...look } = design;
    const result = await saveDesignDraft(look);
    if (!result.success) {
      setError(result.error);
      return null;
    }
    return result.data.draftSavedAt;
  }

  async function onSave() {
    setBusy('save');
    const savedAt = await saveDraft();
    setBusy(null);
    if (savedAt) {
      toast.success('Draft saved — shoppers won’t see it until you publish');
      router.refresh();
    }
  }

  async function onPublish() {
    setBusy('publish');
    const savedAt = dirty || !editor.draftSavedAt ? await saveDraft() : editor.draftSavedAt;
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
    toast.success('Published — your shop has its new look');
    router.refresh();
  }

  async function onPreview() {
    /* Open the tab now, while this is still the click: a window opened after
     * an await is a pop-up most browsers block. */
    const tab = window.open('', '_blank');
    setBusy('preview');
    const savedAt = dirty ? await saveDraft() : 'unchanged';
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
    } else {
      window.location.href = link.data.url;
    }
  }

  const [starting, setStarting] = React.useState<StartingLookId | null>(null);
  const liveStart = startingLookStatus(editor.live);
  const draftStart = editor.draft ? startingLookStatus(editor.draft) : null;

  async function onApplyStartingLook() {
    if (!starting) return;
    setBusy('save');
    const result = await applyStartingLookToDraft(starting);
    setBusy(null);
    setStarting(null);
    if (!result.success) {
      setError(result.error);
      return;
    }
    takeNextBaseline.current = true;
    setError(null);
    toast.success(`${STARTING_LOOKS[starting].label} is in your draft — preview it, change anything, then publish`);
    if (result.data.colourSetAside) {
      toast.warning(
        `Your colour ${result.data.colourSetAside} doesn’t stand out on this look, so it uses its own. You can pick another below.`,
      );
    }
    router.refresh();
  }

  async function onDiscard() {
    setBusy('discard');
    const result = await discardDesignDraft();
    setBusy(null);
    setConfirmDiscard(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success('Draft discarded');
    router.refresh();
  }

  function resetEdits() {
    setDesign(toInput(saved));
    setColourText(saved.brandColour ?? '');
    setError(null);
  }

  const look = LOOKS[design.look];
  const fineTuned = design.corners !== null || design.fonts !== null || design.cards !== null;

  return (
    <div className="space-y-6">
      {/* Where things stand: live, or a draft waiting. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {hasDraft ? (
          <>
            <Badge variant="draft">Draft</Badge>
            <span className="text-muted-foreground">
              You have a saved draft that isn’t live yet. Preview it, then publish when you’re happy.
            </span>
          </>
        ) : (
          <>
            <Badge variant="success">Live</Badge>
            <span className="text-muted-foreground">
              This is what shoppers see
              {editor.publishedAt ? ` — published ${formatDate(editor.publishedAt)}` : ''}. Changes wait until you
              publish them.
            </span>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* ── 0. A starting point (15.6) ─────────────────────────────── */}
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold">Start from a ready-made look</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A look, front page and header made for a kind of shop. It goes into your draft — you can change
            anything before you publish. Your colour, slides and footer stay as they are.
          </p>
        </div>

        {/* Where the shop stands — what shoppers see, and what's waiting in the draft. */}
        <dl className="grid gap-1 rounded-md bg-muted/50 px-3 py-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-3">
          <dt className="text-muted-foreground">On your shop now</dt>
          <dd className="font-medium">{describeStart(liveStart)}</dd>
          {editor.draft && (
            <>
              <dt className="text-muted-foreground">In your draft</dt>
              <dd className="font-medium">{describeStart(draftStart)}</dd>
            </>
          )}
        </dl>

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STARTING_LOOK_IDS.map((id) => {
            const onShop = liveStart?.id === id ? liveStart : null;
            const inDraft = editor.draft && draftStart?.id === id ? draftStart : null;
            /* What "Start from this" would replace: the draft if there is one, else the live shop. */
            const working = editor.draft ? draftStart : liveStart;
            const inUse = working?.id === id && !working.changed;
            return (
              <li
                key={id}
                className={cn(
                  'flex flex-col rounded-md border bg-background p-3',
                  working?.id === id && 'border-primary ring-1 ring-primary',
                )}
              >
                <p className="text-sm font-medium">{STARTING_LOOKS[id].label}</p>
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  {onShop && <Badge variant="success">{onShop.changed ? 'On your shop · changed' : 'On your shop'}</Badge>}
                  {inDraft && <Badge variant="draft">{inDraft.changed ? 'In your draft · changed' : 'In your draft'}</Badge>}
                  {editor.suggestedStartingLook === id && <Badge variant="info">Suggested for your shop</Badge>}
                </p>
                <p className="mt-1.5 flex-1 text-xs text-muted-foreground">{STARTING_LOOKS[id].description}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 self-start"
                  onClick={() => setStarting(id)}
                  disabled={busy !== null || inUse}
                >
                  {inUse ? 'In use' : working?.id === id ? 'Reset to this look' : 'Start from this'}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── 1. The look ──────────────────────────────────────────── */}
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold">Choose a look</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Sets your shop’s fonts, colours, corners and spacing together, so everything matches.
          </p>
        </div>
        <RadioGroup
          value={design.look}
          onValueChange={(value) => set('look', value as LookKey)}
          aria-label="Look"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          {LOOK_KEYS.map((key) => (
            <RadioGroupCard key={key} value={key} id={`look-${key}`} className="p-3">
              <LookSample look={key} colour={design.look === key ? design.brandColour : null} />
              <span className="mt-2.5 block text-sm font-medium">{LOOKS[key].label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{LOOKS[key].description}</span>
            </RadioGroupCard>
          ))}
        </RadioGroup>
      </section>

      {/* ── 2. The colour ────────────────────────────────────────── */}
      <section className="space-y-4 rounded-lg border bg-card p-4">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Palette className="size-4" aria-hidden />
            Brand colour
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Used for buttons, links and highlights. Leave it empty to use the {look.label} look’s own colour.
          </p>
        </div>

        <Field>
          <Label htmlFor="brand-colour">Colour</Label>
          <div className="flex flex-wrap items-center gap-2">
            {/* The native picker for choosing; the text box for pasting a brand hex. */}
            <input
              type="color"
              aria-label="Pick a colour"
              value={isHex(typed) ? typed : look.brand}
              onChange={(event) => changeColour(event.target.value)}
              className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
            />
            <Input
              id="brand-colour"
              value={colourText}
              onChange={(event) => changeColour(event.target.value)}
              placeholder={look.brand}
              className="w-36 font-mono text-xs"
              aria-invalid={Boolean(colourProblem)}
              aria-describedby="brand-colour-help"
            />
            {colourText && (
              <Button type="button" variant="ghost" size="sm" onClick={() => changeColour('')}>
                Use the look’s colour
              </Button>
            )}
          </div>
          {colourProblem ? (
            <FieldError>
              {colourProblem}
              {colourCheck && !colourCheck.ok && colourCheck.suggestion && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="font-medium underline underline-offset-2"
                    onClick={() => changeColour(colourCheck.suggestion!)}
                  >
                    Use {colourCheck.suggestion} instead
                  </button>
                </>
              )}
            </FieldError>
          ) : (
            <FieldDescription id="brand-colour-help">
              {colourCheck?.ok && colourCheck.dark !== typed
                ? 'We pick the text colour on top of it for you, and use a slightly lighter shade in dark mode so it stays readable.'
                : 'We pick white or dark text on top of it for you, so it’s always readable.'}
            </FieldDescription>
          )}
        </Field>
      </section>

      {/* ── 3. Light or dark first ───────────────────────────────── */}
      <section className="rounded-lg border bg-card p-4">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            <span className="flex items-center gap-1.5 font-semibold">
              <SunMoon className="size-4" aria-hidden />
              Open in dark mode
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              How your shop first appears. Shoppers can still switch, and their choice is remembered.
            </span>
          </span>
          <SwitchRoot
            checked={design.darkByDefault}
            onCheckedChange={(checked) => set('darkByDefault', checked)}
            aria-label="Open in dark mode"
          />
        </label>
      </section>

      {/* ── 4. Fine-tune ─────────────────────────────────────────── */}
      <details className="group rounded-lg border bg-card" open={fineTuned || undefined}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span>
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <SlidersHorizontal className="size-4" aria-hidden />
              Fine-tune
              {fineTuned && <Badge variant="muted">Changed</Badge>}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Optional. Change one detail of the {look.label} look without picking another.
            </span>
          </span>
          <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
          <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
        </summary>

        <div className="grid gap-4 border-t p-4 sm:grid-cols-3">
          <OptionSelect
            id="corners"
            label="Corners"
            value={design.corners}
            ownLabel={CORNERS[look.defaults.corners].label}
            options={CORNER_KEYS.map((key) => ({ value: key, label: CORNERS[key].label, hint: CORNERS[key].description }))}
            onChange={(value) => set('corners', value as DesignInput['corners'])}
          />
          <OptionSelect
            id="fonts"
            label="Headings font"
            value={design.fonts}
            ownLabel={FONTS[look.defaults.fonts].label}
            options={FONT_KEYS.map((key) => ({ value: key, label: FONTS[key].label, hint: FONTS[key].description }))}
            onChange={(value) => set('fonts', value as DesignInput['fonts'])}
          />
          <OptionSelect
            id="cards"
            label="Product cards"
            value={design.cards}
            ownLabel={CARDS[look.defaults.cards].label}
            options={CARD_KEYS.map((key) => ({ value: key, label: CARDS[key].label, hint: CARDS[key].description }))}
            onChange={(value) => set('cards', value as DesignInput['cards'])}
          />
        </div>
      </details>

      {/* ── Save, preview, publish ───────────────────────────────── */}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm text-muted-foreground">
          {dirty
            ? 'You have unsaved changes.'
            : hasDraft
              ? 'Your draft is saved but not live.'
              : 'Nothing to publish — your shop shows this look now.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? (
            <Button type="button" variant="ghost" size="sm" onClick={resetEdits} disabled={busy !== null}>
              Undo changes
            </Button>
          ) : (
            hasDraft && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDiscard(true)}
                disabled={busy !== null}
              >
                Discard draft
              </Button>
            )
          )}
          {dirty && (
            <Button type="button" variant="outline" size="sm" onClick={onSave} disabled={busy !== null}>
              {busy === 'save' && <Loader2 className="size-3.5 animate-spin" />}
              Save draft
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={onPreview} disabled={busy !== null}>
            {busy === 'preview' ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
            Preview
          </Button>
          <Button type="button" size="sm" onClick={onPublish} disabled={busy !== null || (!dirty && !hasDraft)}>
            {busy === 'publish' && <Loader2 className="size-3.5 animate-spin" />}
            Publish
          </Button>
        </div>
      </div>

      <AlertDialogRoot open={starting !== null} onOpenChange={(open) => !open && setStarting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start from “{starting ? STARTING_LOOKS[starting].label : ''}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Your draft’s look, front page and header are replaced with this starting point. Your live shop
              doesn’t change until you publish, and your colour, slides and footer are kept. Save or undo unsaved
              changes on the other tabs first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my draft</AlertDialogCancel>
            <Button onClick={onApplyStartingLook} disabled={busy !== null}>
              {busy === 'save' && <Loader2 className="size-3.5 animate-spin" />}
              Use this starting look
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>

      <AlertDialogRoot open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your draft?</AlertDialogTitle>
            <AlertDialogDescription>
              The look you saved but didn’t publish is thrown away. Your live shop doesn’t change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button variant="destructive" onClick={onDiscard} disabled={busy === 'discard'}>
              {busy === 'discard' && <Loader2 className="size-3.5 animate-spin" />}
              Discard draft
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </div>
  );
}

/* ─── A small picture of a look ──────────────────────────────────────── */

/*
 * A sketch of the look's own palette and shape: page, heading, a product
 * tile and a button. The colours are the LOOK's (lib/storefront/design/
 * looks.ts), drawn as data rather than admin theme colours, because what's
 * being shown is the shop, not the admin. "Preview" shows the real thing.
 */
function LookSample({ look, colour }: { look: LookKey; colour: string | null }) {
  const info = LOOKS[look];
  const radius = { square: '2px', soft: '6px', round: '999px' }[info.defaults.corners];
  const tileRadius = { square: '2px', soft: '6px', round: '12px' }[info.defaults.corners];
  const brand = colour ?? info.brand;
  return (
    <span
      aria-hidden
      className="block w-full overflow-hidden rounded-md border p-3"
      style={{ backgroundColor: info.background, color: info.foreground }}
    >
      <span
        className={cn('block text-base leading-tight', info.defaults.fonts === 'modern' ? 'font-bold tracking-tight' : 'font-semibold')}
        style={{
          fontFamily: info.defaults.fonts === 'modern' || info.defaults.fonts === 'friendly' ? 'inherit' : 'Georgia, serif',
        }}
      >
        Aa
      </span>
      <span className="mt-2 flex items-end gap-2">
        <span className="block size-9 shrink-0" style={{ backgroundColor: info.tile, borderRadius: tileRadius }} />
        <span className="block h-5 flex-1" style={{ backgroundColor: brand, borderRadius: radius }} />
      </span>
    </span>
  );
}

/* ─── One Fine-tune choice ───────────────────────────────────────────── */

function OptionSelect({
  id,
  label,
  value,
  ownLabel,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  ownLabel: string;
  options: { value: string; label: string; hint: string }[];
  onChange: (value: string | null) => void;
}) {
  const chosen = options.find((option) => option.value === value);
  return (
    <Field>
      <Label htmlFor={id}>{label}</Label>
      <SelectRoot value={value ?? LOOKS_OWN} onValueChange={(next) => onChange(next === LOOKS_OWN ? null : next)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={LOOKS_OWN}>The look’s own ({ownLabel})</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </SelectRoot>
      <FieldDescription>{chosen ? chosen.hint : 'Follows the look you chose.'}</FieldDescription>
    </Field>
  );
}
