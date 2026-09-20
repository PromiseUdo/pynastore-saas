'use client';

/*
 * Settings → Store pages.
 *
 * Two parts: the pages the merchant has, and — below them — the standard
 * pages they haven't written yet, each with a one-line purpose and a
 * "Write" button. The second part doubles as the empty state: a store with
 * no pages sees exactly which pages customers usually look for.
 *
 * Every link to a page on the storefront is built from what is PUBLISHED
 * here, so a draft is invisible to shoppers and a deleted page takes its
 * links with it.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  ExternalLink,
  EyeOff,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { TablePagination } from '@/components/ui/table-pagination';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from '@/components/ui/table';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { formatDate } from '@/lib/format';
import { SINGLE_KINDS, STORE_PAGE_KIND_INFO, storePageHref } from '@/lib/storefront/pages/rules';
import { deleteStorePage, setStorePagePublished, type StorePageRow } from '@/features/settings/store-pages';

const PAGE_SIZE = 20;

type StatusFilter = 'all' | 'published' | 'draft';

export function StorePagesClient({
  pages,
  canManage,
  storeUrl,
}: {
  pages: StorePageRow[];
  canManage: boolean;
  /** the storefront's address, without a trailing slash */
  storeUrl: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [deleting, setDeleting] = React.useState<StorePageRow | null>(null);
  const [pending, setPending] = React.useState(false);

  const query = searchParams.get('q') ?? '';
  const statusFilter = (searchParams.get('status') ?? 'all') as StatusFilter;
  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return pages.filter((p) => {
      if (needle && !`${p.title} ${p.slug} ${STORE_PAGE_KIND_INFO[p.kind].label}`.toLowerCase().includes(needle)) {
        return false;
      }
      if (statusFilter === 'published' && !p.isPublished) return false;
      if (statusFilter === 'draft' && p.isPublished) return false;
      return true;
    });
  }, [pages, query, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const written = new Set(pages.map((p) => p.kind));
  const missing = SINGLE_KINDS.filter((kind) => !written.has(kind));

  async function togglePublished(row: StorePageRow) {
    const result = await setStorePagePublished(row.id, !row.isPublished);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(row.isPublished ? `“${row.title}” is hidden from your store` : `“${row.title}” is live on your store`);
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setPending(true);
    const result = await deleteStorePage(deleting.id);
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`Deleted “${deleting.title}”`);
    setDeleting(null);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Store pages"
        description="Pages customers can read in your online store — delivery and returns, terms, privacy and more. You write every word, and nothing shows until you publish it."
        actions={
          canManage ? (
            <Link href="/settings/pages/new?kind=CUSTOM" className={buttonVariants({ size: 'sm' })}>
              <Plus className="size-3.5" />
              New page
            </Link>
          ) : undefined
        }
      />

      {pages.length > 0 && (
        <PageToolbar>
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search pages"
              placeholder="Search pages"
              defaultValue={query}
              onChange={(e) => setParams({ q: e.target.value })}
              className="pl-8"
            />
          </div>
          <SelectRoot value={statusFilter} onValueChange={(value) => setParams({ status: value === 'all' ? null : value })}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All pages</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="draft">Drafts</SelectItem>
            </SelectContent>
          </SelectRoot>
        </PageToolbar>
      )}

      <PageBody className="space-y-10">
        {pages.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No store pages yet"
            description="Customers look for these before they buy: how delivery and returns work, who you are, and how to reach you. Start with any page below — it stays a draft until you publish it."
            action={
              !canManage ? <p className="text-xs text-muted-foreground">Ask an admin to write your store pages.</p> : undefined
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            variant="filtered"
            title="No pages match"
            description="Nothing here fits that search or status."
            action={
              <Button size="sm" variant="outline" onClick={() => setParams({ q: null, status: null })}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Page</TableColumnHeader>
                  <TableColumnHeader className="hidden md:table-cell">Web address</TableColumnHeader>
                  <TableColumnHeader>Status</TableColumnHeader>
                  <TableColumnHeader className="hidden sm:table-cell">Last changed</TableColumnHeader>
                  <TableColumnHeader>
                    <span className="sr-only">Actions</span>
                  </TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((row) => {
                  const href = `/settings/pages/${row.id}`;
                  return (
                    <TableRow key={row.id} clickable onClick={() => router.push(href)}>
                      <TableCell>
                        <Link
                          href={href}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-foreground hover:underline"
                        >
                          {row.title}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {STORE_PAGE_KIND_INFO[row.kind].label}
                          {row.wordCount === 0 && ' · nothing written yet'}
                        </p>
                      </TableCell>
                      <TableCell muted className="hidden font-mono text-xs md:table-cell">
                        {storePageHref(row.slug)}
                      </TableCell>
                      <TableCell>
                        {row.isPublished ? (
                          <Badge variant="success">Published</Badge>
                        ) : (
                          <Badge variant="draft">Draft</Badge>
                        )}
                      </TableCell>
                      <TableCell muted className="hidden sm:table-cell">
                        {formatDate(row.updatedAt)}
                      </TableCell>
                      <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuRoot>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.title}`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onSelect={() => router.push(href)}>
                              <Pencil />
                              {canManage ? 'Edit' : 'Open'}
                            </DropdownMenuItem>
                            {row.isPublished && (
                              <DropdownMenuItem asChild>
                                <a href={`${storeUrl}${storePageHref(row.slug)}`} target="_blank" rel="noreferrer">
                                  <ExternalLink />
                                  View on store
                                </a>
                              </DropdownMenuItem>
                            )}
                            {canManage && (
                              <>
                                <DropdownMenuItem onSelect={() => void togglePublished(row)}>
                                  {row.isPublished ? <EyeOff /> : <Send />}
                                  {row.isPublished ? 'Unpublish' : 'Publish'}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={() => setDeleting(row)}
                                >
                                  <Trash2 />
                                  Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenuRoot>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {filtered.length > PAGE_SIZE && (
              <TablePagination
                page={currentPage}
                totalPages={totalPages}
                totalItems={filtered.length}
                pageSize={PAGE_SIZE}
                onPageChange={(next) => setParams({ page: next === 1 ? null : String(next) })}
              />
            )}
          </TableWrapper>
        )}

        {canManage && missing.length > 0 && (
          <section aria-labelledby="suggested-heading">
            <h2 id="suggested-heading" className="text-sm font-semibold">
              {pages.length ? 'Pages you haven’t written yet' : 'Pages most stores have'}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Each one is linked from the right place in your store once it’s published — the footer, checkout, the
              cookie notice or product pages.
            </p>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {missing.map((kind) => {
                const info = STORE_PAGE_KIND_INFO[kind];
                return (
                  <li key={kind} className="flex flex-col rounded-lg border bg-card p-4">
                    <p className="text-sm font-medium">{info.label}</p>
                    <p className="mt-0.5 flex-1 text-xs text-muted-foreground">{info.purpose}</p>
                    <Link
                      href={`/settings/pages/new?kind=${kind}`}
                      className={buttonVariants({ variant: 'outline', size: 'sm', className: 'mt-3 self-start' })}
                    >
                      <Pencil className="size-3.5" />
                      Write page
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </PageBody>

      {canManage && (
        <AlertDialogRoot open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{deleting?.title}”?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleting?.isPublished
                  ? 'It disappears from your store straight away, along with every link to it, and anyone who saved the link will find nothing there. This can’t be undone. To hide it for now, unpublish it instead.'
                  : 'The draft and everything written in it will be gone. This can’t be undone.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button variant="destructive" onClick={confirmDelete} disabled={pending}>
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                Delete page
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogRoot>
      )}
    </>
  );
}
