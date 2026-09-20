'use client';

/*
 * Write or edit one store page.
 *
 * A full page rather than a sheet: the body is long, and the merchant wants
 * to read it back (Preview) before customers do. The sidebar says where the
 * page will be linked, what such a page usually covers, and — for Delivery
 * and returns — what the store's settings actually enforce, so the words
 * and the rules can be made to agree.
 *
 * Nothing here writes page text for the merchant. "What to cover" is a
 * checklist beside the box, never inserted into it.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink, Loader2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SwitchRoot } from '@/components/ui/switch';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { PageBlocks } from '@/components/content/page-blocks';
import { formatDate } from '@/lib/format';
import { parsePageBody, PAGE_BODY_MAX } from '@/lib/storefront/pages/format';
import {
  PAGE_SLUG_MAX,
  STORE_PAGE_KIND_INFO,
  pageSlugFrom,
  storePageHref,
  type StorePageKind,
} from '@/lib/storefront/pages/rules';
import {
  deleteStorePage,
  saveStorePage,
  type StoreFacts,
  type StorePageDetail,
} from '@/features/settings/store-pages';

/** Where the storefront links each kind of page, said the way a merchant would. */
const LINKED_FROM: Record<StorePageKind, string> = {
  ABOUT: 'Linked in your store’s footer.',
  DELIVERY_RETURNS: 'Linked in the footer, at checkout, and in the delivery panel on every product page.',
  FAQ: 'Linked in your store’s footer.',
  SIZE_GUIDE: 'Linked in the footer, and on product pages for anything that comes in sizes.',
  CONTACT: 'Linked in the footer and at checkout.',
  TERMS: 'Linked in the footer and at checkout.',
  PRIVACY: 'Linked in the footer, at checkout, and from the cookie notice.',
  CUSTOM: 'Linked in your store’s footer.',
};

const FORMATTING_HELP: { write: string; get: string }[] = [
  { write: '## Delivery times', get: 'a section heading' },
  { write: '### Lagos', get: 'a smaller heading' },
  { write: '- Lagos: 1–2 days', get: 'a bulleted list' },
  { write: '1. Pack the item', get: 'a numbered list' },
  { write: '**important**', get: 'bold text' },
  { write: '[our shop](/products)', get: 'a link' },
  { write: '| Size | Chest |', get: 'a table row (first row is the header)' },
];

type Tab = 'write' | 'preview';

export function StorePageEditor({
  page,
  kind,
  canManage,
  storeUrl,
  facts,
}: {
  /** null for a new page */
  page: StorePageDetail | null;
  kind: StorePageKind;
  canManage: boolean;
  /** the storefront's address, without a trailing slash */
  storeUrl: string;
  facts: StoreFacts | null;
}) {
  const router = useRouter();
  const info = STORE_PAGE_KIND_INFO[kind];
  const isNew = page === null;
  /** "about us page", or just "page" for one of the merchant's own */
  const noun = kind === 'CUSTOM' ? 'page' : `${info.label.toLowerCase()} page`;

  const initial = React.useMemo(
    () => ({
      title: page?.title ?? (kind === 'CUSTOM' ? '' : info.label),
      slug: page?.slug ?? (kind === 'CUSTOM' ? '' : info.slug),
      body: page?.body ?? '',
      isPublished: page?.isPublished ?? false,
    }),
    [page, kind, info],
  );

  const [title, setTitle] = React.useState(initial.title);
  const [slug, setSlug] = React.useState(initial.slug);
  /* A new custom page's address follows its title until the merchant types
   * one themselves. An existing page's never follows — see the note on
   * web addresses in features/settings/store-pages.ts. */
  const [slugTouched, setSlugTouched] = React.useState(!isNew || kind !== 'CUSTOM');
  const [body, setBody] = React.useState(initial.body);
  const [isPublished, setIsPublished] = React.useState(initial.isPublished);
  const [tab, setTab] = React.useState<Tab>('write');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const dirty =
    isNew ||
    title !== initial.title ||
    slug !== initial.slug ||
    body !== initial.body ||
    isPublished !== initial.isPublished;

  const blocks = React.useMemo(() => (tab === 'preview' ? parsePageBody(body) : []), [tab, body]);
  const readOnly = !canManage;

  function changeTitle(value: string) {
    setTitle(value);
    if (!slugTouched) setSlug(value.trim() ? pageSlugFrom(value) : '');
  }

  function discard() {
    setTitle(initial.title);
    setSlug(initial.slug);
    setBody(initial.body);
    setIsPublished(initial.isPublished);
    setErrors({});
    setFormError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);

    const result = await saveStorePage(page?.id ?? null, { kind, title, slug, body, isPublished });
    setSaving(false);

    if (!result.success) {
      setErrors(result.fieldErrors ?? {});
      setFormError(result.error);
      if (result.fieldErrors?.body) setTab('write');
      return;
    }

    toast.success(
      isPublished
        ? `“${title.trim()}” is live on your store`
        : isNew
          ? `“${title.trim()}” saved as a draft`
          : `Saved “${title.trim()}”`,
    );
    if (isNew) router.replace(`/settings/pages/${result.data.id}`);
    else {
      setSlug(result.data.slug);
      router.refresh();
    }
  }

  async function confirmDelete() {
    if (!page) return;
    setDeleting(true);
    const result = await deleteStorePage(page.id);
    setDeleting(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`Deleted “${page.title}”`);
    router.replace('/settings/pages');
  }

  const liveUrl = page?.isPublished ? `${storeUrl}${storePageHref(page.slug)}` : null;

  return (
    <form onSubmit={submit} noValidate>
      <div className="border-b bg-background px-4 py-4 sm:px-6">
        <Link
          href="/settings/pages"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Store pages
        </Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
              {isNew ? title.trim() || `New ${noun}` : page.title}
            </h1>
            {page?.isPublished ? <Badge variant="success">Published</Badge> : <Badge variant="draft">Draft</Badge>}
          </div>
          {liveUrl && (
            <a
              href={liveUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'sm', className: 'self-start' })}
            >
              <ExternalLink className="size-3.5" />
              View on store
            </a>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {page?.isPublished
            ? `Customers can read this page. Last changed ${formatDate(page.updatedAt)}.`
            : 'A draft — customers can’t see it, and nothing links to it, until you publish it.'}
        </p>
      </div>

      <div className="min-w-0 px-4 py-6 sm:px-6">
        {formError && (
          <p
            role="alert"
            className="mb-5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-5">
            <Field>
              <Label htmlFor="page-title">Title *</Label>
              <Input
                id="page-title"
                value={title}
                onChange={(e) => changeTitle(e.target.value)}
                disabled={readOnly}
                maxLength={80}
                placeholder={kind === 'CUSTOM' ? 'e.g. Wholesale orders' : info.label}
                aria-invalid={errors.title ? true : undefined}
              />
              {errors.title ? (
                <FieldError>{errors.title}</FieldError>
              ) : (
                <FieldDescription>The heading on the page, and the words used to link to it.</FieldDescription>
              )}
            </Field>

            <Field>
              <Label htmlFor="page-slug">Web address</Label>
              <div className="flex items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring dark:bg-input/30">
                <span className="shrink-0 pl-3 font-mono text-sm text-muted-foreground">/pages/</span>
                <input
                  id="page-slug"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'));
                  }}
                  maxLength={PAGE_SLUG_MAX}
                  disabled={readOnly}
                  placeholder={pageSlugFrom(title || 'page')}
                  aria-invalid={errors.slug ? true : undefined}
                  className="h-9 min-w-0 flex-1 bg-transparent pr-3 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
                />
              </div>
              {errors.slug ? (
                <FieldError>{errors.slug}</FieldError>
              ) : (
                <FieldDescription>
                  {isNew
                    ? 'Lower-case letters, numbers and dashes. Leave it as it is unless you have a reason to change it.'
                    : 'Renaming the page doesn’t change this. If you change it, links people saved to the old address will stop working.'}
                </FieldDescription>
              )}
            </Field>

            <Field>
              <div className="flex items-end justify-between gap-3">
                <Label htmlFor="page-body">Page text{isPublished ? ' *' : ''}</Label>
                <div role="tablist" aria-label="Write or preview" className="inline-flex rounded-md border p-0.5">
                  {(['write', 'preview'] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={tab === key}
                      onClick={() => setTab(key)}
                      className={cn(
                        'h-7 rounded px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        tab === key ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {key === 'write' ? 'Write' : 'Preview'}
                    </button>
                  ))}
                </div>
              </div>

              {tab === 'write' ? (
                <Textarea
                  id="page-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={readOnly}
                  rows={22}
                  maxLength={PAGE_BODY_MAX}
                  placeholder={`Write your ${noun} here, in your own words.`}
                  aria-invalid={errors.body ? true : undefined}
                  className="min-h-[24rem] resize-y font-mono text-[13px] leading-relaxed"
                />
              ) : (
                <div className="min-h-[24rem] rounded-md border bg-card px-5 py-5">
                  <h2 className="text-xl font-semibold text-foreground">{title.trim() || 'Untitled page'}</h2>
                  {blocks.length ? (
                    <PageBlocks blocks={blocks} preview className="mt-4" />
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">Nothing written yet.</p>
                  )}
                </div>
              )}

              {errors.body ? (
                <FieldError>{errors.body}</FieldError>
              ) : (
                <FieldDescription>
                  Leave a blank line between paragraphs. Web and email addresses become links on their own.
                </FieldDescription>
              )}
            </Field>

            <details className="rounded-md border bg-card px-4 py-3 text-sm">
              <summary className="cursor-pointer select-none font-medium">Formatting help</summary>
              <table className="mt-3 w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th scope="col" className="pb-1.5 font-medium">
                      Type
                    </th>
                    <th scope="col" className="pb-1.5 font-medium">
                      To get
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {FORMATTING_HELP.map((row) => (
                    <tr key={row.write} className="border-t">
                      <td className="py-1.5 pr-3 font-mono">{row.write}</td>
                      <td className="py-1.5 text-muted-foreground">{row.get}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>

          <aside className="space-y-4">
            <section className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="page-published">Published</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {isPublished ? LINKED_FROM[kind] : 'Off: only you and your team can see this page.'}
                  </p>
                </div>
                <SwitchRoot id="page-published" checked={isPublished} onCheckedChange={setIsPublished} disabled={readOnly} />
              </div>
            </section>

            <section className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold">{info.label}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{info.purpose}</p>
              {info.covers.length > 0 && (
                <>
                  <p className="mt-3 text-xs font-medium">Stores usually cover</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                    {info.covers.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
              {(kind === 'TERMS' || kind === 'PRIVACY') && (
                <p className="mt-3 text-xs text-muted-foreground">
                  This page can carry legal weight. If you aren’t sure what yours should say, ask a lawyer.
                </p>
              )}
            </section>

            {kind === 'DELIVERY_RETURNS' && facts && <StoreFactsCard facts={facts} />}

            {!isNew && canManage && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-3.5" />
                Delete page
              </Button>
            )}
          </aside>
        </div>

        {canManage && dirty && (
          <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
            <p className="text-sm text-muted-foreground">
              {isNew ? 'This page isn’t saved yet.' : 'You have unsaved changes.'}
            </p>
            <div className="flex items-center gap-2">
              {isNew ? (
                <Link href="/settings/pages" className="text-sm text-muted-foreground hover:text-foreground">
                  Cancel
                </Link>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={discard}>
                  Discard
                </Button>
              )}
              <Button type="submit" size="sm" disabled={saving}>
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {isPublished && !initial.isPublished ? 'Publish page' : isNew ? 'Save draft' : 'Save page'}
              </Button>
            </div>
          </div>
        )}

        {readOnly && <p className="mt-6 text-xs text-muted-foreground">Ask an admin to change your store pages.</p>}
      </div>

      {page && canManage && (
        <AlertDialogRoot open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{page.title}”?</AlertDialogTitle>
              <AlertDialogDescription>
                {page.isPublished
                  ? 'It disappears from your store straight away, along with every link to it. This can’t be undone. To hide it for now, switch off Published instead.'
                  : 'The draft and everything written in it will be gone. This can’t be undone.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button type="button" variant="destructive" onClick={confirmDelete} disabled={deleting}>
                {deleting && <Loader2 className="size-3.5 animate-spin" />}
                Delete page
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogRoot>
      )}
    </form>
  );
}

/**
 * What checkout and the returns form actually do, beside the page that
 * describes them. If the page says 30 days and this says 14, the customer
 * who relies on the page is the one who loses out.
 */
function StoreFactsCard({ facts }: { facts: StoreFacts }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">What your settings say</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        This is what your store actually does. Make sure the page says the same.
      </p>
      <ul className="mt-3 space-y-2 text-xs">
        <li>
          <span className="font-medium">Returns: </span>
          <span className="text-muted-foreground">
            {facts.returnWindowDays
              ? `customers can ask within ${facts.returnWindowDays} days of delivery`
              : 'not accepted through the website'}
          </span>
        </li>
        <li>
          <span className="font-medium">Delivery: </span>
          <span className="text-muted-foreground">
            {facts.activeDeliveryZones
              ? `${facts.activeDeliveryZones} delivery area${facts.activeDeliveryZones === 1 ? '' : 's'} switched on`
              : 'no delivery areas set up'}
          </span>
        </li>
        <li>
          <span className="font-medium">Collection: </span>
          <span className="text-muted-foreground">
            {facts.activePickupLocations
              ? `${facts.activePickupLocations} pickup point${facts.activePickupLocations === 1 ? '' : 's'}`
              : 'no pickup points'}
          </span>
        </li>
      </ul>
      <Link href="/settings/delivery" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
        Change delivery and returns settings
      </Link>
    </section>
  );
}
