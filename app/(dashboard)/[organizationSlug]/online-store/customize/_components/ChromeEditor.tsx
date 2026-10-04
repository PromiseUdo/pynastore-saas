'use client';

/*
 * Online store → Customize → Header & footer (ROADMAP 15.5).
 *
 * The header: one of three layouts. The footer: which of its columns show,
 * in what order, and one column of the merchant's own links. The standard
 * columns are still worked out from the shop's own data — departments,
 * account pages, published store pages — and are never retyped here; the
 * name, contact details and social links always come first and are edited
 * in Settings → General.
 *
 * Saved into the same draft as the look and the front page; nothing is live
 * until Publish.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ExternalLink, Loader2, Plus, Trash2, X } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import {
  HEADER_LAYOUTS,
  MAX_FOOTER_LINKS,
  classicFooter,
  type FooterColumnConfig,
  type FooterConfig,
  type HeaderLayout,
} from '@/lib/storefront/design/schema';
import { createDesignPreviewLink, publishDesign, saveChromeDraft, type DesignEditorData } from '@/features/storefront/design';
import { PreviewPane } from './PreviewPane';

type Destination = { label: string; href: string };
type LinksColumn = Extract<FooterColumnConfig, { key: 'links' }>;

const HEADER_INFO: Record<HeaderLayout, { label: string; description: string }> = {
  standard: { label: 'Standard', description: 'Your name on the left, search in the middle, bag on the right.' },
  centered: { label: 'Centred', description: 'Your name or logo in the middle. Search sits behind a button.' },
  search: { label: 'Large search', description: 'A search box always in view — full width on phones.' },
};

const COLUMN_INFO: Record<Exclude<FooterColumnConfig['key'], 'links'>, { label: string; description: string }> = {
  shop: { label: 'Shop', description: 'All products, collections and your first four departments.' },
  account: { label: 'Your account', description: 'Track an order, past orders, saved items, sign in.' },
  help: {
    label: 'Help',
    description: 'Your published help pages — delivery and returns, FAQ, size guide, contact. Shows once one is published.',
  },
  about: {
    label: 'About us',
    description: 'Your published About, Terms and Privacy pages. Shows once one is published.',
  },
};

function problemIn(footer: FooterConfig): string | null {
  const own = footer.columns.find((c): c is LinksColumn => c.key === 'links');
  if (own?.enabled) {
    if (!own.title.trim()) return 'Give your own column a heading.';
    if (!own.links.length) return 'Add at least one link to your own column, or turn it off.';
    if (own.links.some((l) => !l.label.trim() || !l.href)) return 'Every link in your column needs its words and a page.';
  }
  return null;
}

export function ChromeEditor({
  editor,
  destinations,
  active,
}: {
  editor: DesignEditorData;
  destinations: Destination[];
  active: boolean;
}) {
  const router = useRouter();
  const source = editor.draft ?? editor.live;
  const saved = React.useMemo(
    () => ({ header: source.header, footer: source.footer ?? classicFooter() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor],
  );
  const [header, setHeader] = React.useState(saved.header);
  const [footer, setFooter] = React.useState<FooterConfig>(saved.footer);
  const [removingOwn, setRemovingOwn] = React.useState(false);
  const [busy, setBusy] = React.useState<null | 'save' | 'publish' | 'preview'>(null);
  const [error, setError] = React.useState<string | null>(null);

  const dirty = JSON.stringify({ header, footer }) !== JSON.stringify(saved);
  const hasDraft = editor.draft !== null;
  const problem = problemIn(footer);

  /* A new baseline when something is saved or published — keyed on when, so
   * switching tabs never wipes edits in progress. */
  const savedKey = `${editor.draftSavedAt ?? ''}|${editor.publishedAt ?? ''}`;
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;
  React.useEffect(() => {
    if (dirtyRef.current) return;
    setHeader(saved.header);
    setFooter(saved.footer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /* ── the footer's columns ──────────────────────────────────────── */

  const own = footer.columns.find((c): c is LinksColumn => c.key === 'links') ?? null;

  function setColumns(update: (columns: FooterColumnConfig[]) => FooterColumnConfig[]) {
    setFooter((current) => ({ columns: update(current.columns) }));
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= footer.columns.length) return;
    setColumns((columns) => {
      const next = [...columns];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }
  function patchOwn(patch: Partial<LinksColumn>) {
    setColumns((columns) => columns.map((c) => (c.key === 'links' ? { ...c, ...patch } : c)));
  }

  /* ── saving ────────────────────────────────────────────────────── */

  async function save(): Promise<string | null> {
    if (problem) {
      setError(problem);
      return null;
    }
    setError(null);
    const result = await saveChromeDraft({ header, footer });
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
    toast.success('Published — your new header and footer are live');
    router.refresh();
  }

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
      <div className="space-y-6">
        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {/* ── Header ─────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Header</h2>
            <p className="text-xs text-muted-foreground">The bar at the top of every page of your shop.</p>
          </div>
          <RadioGroup
            value={header.layout}
            onValueChange={(layout) => setHeader({ layout: layout as HeaderLayout })}
            aria-label="Header layout"
            className="gap-2"
          >
            {HEADER_LAYOUTS.map((layout) => (
              <RadioGroupCard key={layout} value={layout} id={`header-${layout}`} className="p-3">
                <span className="block text-sm font-medium">{HEADER_INFO[layout].label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{HEADER_INFO[layout].description}</span>
              </RadioGroupCard>
            ))}
          </RadioGroup>
        </section>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Footer</h2>
              <p className="text-xs text-muted-foreground">
                Left to right on a computer, top to bottom on a phone. Your name, contact details and social links
                always come first — change them in{' '}
                <Link href="/settings" className="underline underline-offset-2">
                  Settings → General
                </Link>
                .
              </p>
            </div>
            {!own && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setColumns((columns) => [...columns, { key: 'links', enabled: true, title: '', links: [] }])
                }
              >
                <Plus className="size-3.5" />
                Add your own column
              </Button>
            )}
          </div>

          <ol className="divide-y rounded-lg border bg-card">
            {footer.columns.map((column, index) => {
              const label = column.key === 'links' ? column.title || 'Your own links' : COLUMN_INFO[column.key].label;
              return (
                <li key={column.key} className={cn('px-3 py-2.5', !column.enabled && 'bg-muted/40')}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        {label}
                        {!column.enabled && <Badge variant="muted">Hidden</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {column.key === 'links'
                          ? `${column.links.length} of ${MAX_FOOTER_LINKS} links`
                          : COLUMN_INFO[column.key].description}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <SwitchRoot
                        checked={column.enabled}
                        onCheckedChange={(enabled) =>
                          setColumns((columns) => columns.map((c) => (c.key === column.key ? { ...c, enabled } : c)))
                        }
                        aria-label={`Show “${label}”`}
                        className="mr-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Move “${label}” earlier`}
                        disabled={index === 0}
                        onClick={() => move(index, index - 1)}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Move “${label}” later`}
                        disabled={index === footer.columns.length - 1}
                        onClick={() => move(index, index + 1)}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      {column.key === 'links' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          aria-label="Remove your own column"
                          onClick={() => setRemovingOwn(true)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {column.key === 'links' && (
                    <OwnColumnForm column={column} destinations={destinations} onChange={patchOwn} />
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <Button type="button" variant="outline" size="sm" className="lg:hidden" onClick={onPreviewTab} disabled={busy !== null}>
          {busy === 'preview' ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
          Preview in a new tab
        </Button>
      </div>

      <div className="hidden lg:sticky lg:top-4 lg:block">
        {active && <PreviewPane reloadKey={savedKey} dirty={dirty} />}
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:col-span-2">
        <p className="text-sm text-muted-foreground">
          {dirty
            ? 'You have unsaved changes.'
            : hasDraft
              ? 'Your draft is saved but not live.'
              : 'Nothing to publish — this is your live header and footer.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setHeader(saved.header);
                setFooter(saved.footer);
                setError(null);
              }}
              disabled={busy !== null}
            >
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

      <AlertDialogRoot open={removingOwn} onOpenChange={setRemovingOwn}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove your own column?</AlertDialogTitle>
            <AlertDialogDescription>
              Its heading and links come off your draft footer. Your live shop doesn’t change until you publish. To
              keep it but not show it, turn it off instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                setColumns((columns) => columns.filter((c) => c.key !== 'links'));
                setRemovingOwn(false);
              }}
            >
              Remove column
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </div>
  );
}

/* ─── The merchant's own column ──────────────────────────────────────── */

function OwnColumnForm({
  column,
  destinations,
  onChange,
}: {
  column: LinksColumn;
  destinations: Destination[];
  onChange: (patch: Partial<LinksColumn>) => void;
}) {
  const setLink = (index: number, patch: Partial<LinksColumn['links'][number]>) =>
    onChange({ links: column.links.map((link, i) => (i === index ? { ...link, ...patch } : link)) });

  return (
    <div className="mt-3 grid gap-3 rounded-md border bg-background p-3">
      <Field>
        <Label htmlFor="own-title">
          Heading <span className="text-destructive">*</span>
        </Label>
        <Input
          id="own-title"
          value={column.title}
          maxLength={30}
          placeholder="e.g. Good to know"
          onChange={(event) => onChange({ title: event.target.value })}
          aria-invalid={column.enabled && !column.title.trim()}
        />
      </Field>

      <div className="space-y-2">
        <p className="text-sm font-medium">Links</p>
        {column.links.length === 0 && (
          <p className="text-xs text-muted-foreground">No links yet. Each one goes to a page on your shop.</p>
        )}
        {column.links.map((link, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
            <Input
              value={link.label}
              maxLength={40}
              placeholder="Words"
              aria-label={`Link ${index + 1}: words`}
              onChange={(event) => setLink(index, { label: event.target.value })}
            />
            <SelectRoot value={link.href || undefined} onValueChange={(href) => setLink(index, { href })}>
              <SelectTrigger aria-label={`Link ${index + 1}: goes to`}>
                <SelectValue placeholder="Goes to…" />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((d) => (
                  <SelectItem key={d.href} value={d.href}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </SelectRoot>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Remove link ${index + 1}`}
              onClick={() => onChange({ links: column.links.filter((_, i) => i !== index) })}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ))}
        {column.links.length < MAX_FOOTER_LINKS && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange({ links: [...column.links, { label: '', href: '' }] })}
          >
            <Plus className="size-3.5" />
            Add a link
          </Button>
        )}
        {column.enabled && column.links.some((l) => !l.label.trim() || !l.href) && (
          <FieldError>Every link needs its words and a page to go to.</FieldError>
        )}
        <FieldDescription>Up to {MAX_FOOTER_LINKS} links, each to a page on your shop.</FieldDescription>
      </div>
    </div>
  );
}
