'use client';

/*
 * Post history.
 *
 * One row per post, with the two things that matter afterwards: did it go
 * out, and if not, why. A failed post keeps its caption, images and
 * destination, so "Try again" is a real retry of that record rather than an
 * invitation to type it all out once more.
 *
 * Search, filters and the page number are written to the URL and read back
 * by the server (AGENTS.md §3), so the list can be refreshed, bookmarked or
 * sent to a colleague. Nothing is filtered in the browser — this component
 * only ever holds the page it was given.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ExternalLink, Loader2, RefreshCw, Search, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
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
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { PlatformIcon } from '@/components/social/platform-icon';
import { SocialNav } from '@/components/social/social-nav';
import { formatDate } from '@/lib/format';
import { discardSocialPost, retrySocialPost } from '@/features/social/posts';
import {
  PLATFORM_LABELS,
  POST_STATUS_LABELS,
  type SocialPostListResult,
  type SocialPostRow,
  type SocialPostStatus,
} from '@/lib/social/types';

const STATUS_VARIANTS: Record<SocialPostStatus, 'success' | 'warning' | 'destructive' | 'muted'> = {
  PUBLISHED: 'success',
  PUBLISHING: 'warning',
  FAILED: 'destructive',
  DRAFT: 'muted',
};

export function PostHistoryClient({
  result,
  canManage,
}: {
  result: SocialPostListResult;
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [retrying, setRetrying] = React.useState<string | null>(null);
  const [discarding, setDiscarding] = React.useState<SocialPostRow | null>(null);
  const [pending, setPending] = React.useState(false);

  const status = searchParams.get('status') ?? 'all';
  const platform = searchParams.get('platform') ?? 'all';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const [query, setQuery] = React.useState(searchParams.get('q') ?? '');

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '' || value === 'all') next.delete(key);
        else next.set(key, value);
      }
      // Any change to what's being looked at starts again at the first page.
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  /* Typing shouldn't hit the database on every keystroke, and it shouldn't
   * push a history entry per character either — hence replace(), debounced. */
  const urlQuery = searchParams.get('q') ?? '';
  React.useEffect(() => {
    if (query === urlQuery) return;
    const timer = setTimeout(() => setParams({ q: query }), 350);
    return () => clearTimeout(timer);
  }, [query, urlQuery, setParams]);

  async function handleRetry(post: SocialPostRow) {
    setRetrying(post.id);
    const outcome = await retrySocialPost(post.id);
    setRetrying(null);

    if (!outcome.success) {
      toast.error(outcome.error);
      router.refresh();
      return;
    }
    toast.success(`Published to ${outcome.data.accountName}`);
    router.refresh();
  }

  async function handleDiscard() {
    if (!discarding) return;
    setPending(true);
    const outcome = await discardSocialPost(discarding.id);
    setPending(false);

    if (!outcome.success) {
      toast.error(outcome.error);
      return;
    }
    toast.success('Post removed from history');
    setDiscarding(null);
    router.refresh();
  }

  const filtered = status !== 'all' || platform !== 'all' || from !== '' || to !== '' || urlQuery !== '';

  const header = (
    <>
      <PageHeader
        title="Post history"
        description="Every post you’ve sent to a social account from MansaaS, and what became of it."
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/social/compose">
                <Send className="size-4" />
                Create post
              </Link>
            </Button>
          ) : undefined
        }
      />
      <SocialNav />
    </>
  );

  /* No posts at all is a different message from "your filters hid them". */
  if (result.historySize === 0) {
    return (
      <div>
        {header}
        <PageBody>
          <EmptyState
            icon={Send}
            title="No posts yet"
            description="When you post a product to Facebook or Instagram, it appears here with whether it went out."
            action={
              canManage ? (
                <Button asChild>
                  <Link href="/social/compose">Create your first post</Link>
                </Button>
              ) : undefined
            }
          />
        </PageBody>
      </div>
    );
  }

  return (
    <div>
      {header}

      <PageToolbar>
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search product, caption or account"
            aria-label="Search posts"
            className="pl-8"
          />
        </div>

        <SelectRoot value={status} onValueChange={(value) => setParams({ status: value })}>
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="PUBLISHED">Published</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
            <SelectItem value="PUBLISHING">Publishing</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
          </SelectContent>
        </SelectRoot>

        <SelectRoot value={platform} onValueChange={(value) => setParams({ platform: value })}>
          <SelectTrigger className="w-44" aria-label="Filter by platform">
            <SelectValue placeholder="All platforms" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            <SelectItem value="FACEBOOK_PAGE">Facebook Page</SelectItem>
            <SelectItem value="INSTAGRAM_BUSINESS">Instagram</SelectItem>
          </SelectContent>
        </SelectRoot>

        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setParams({ from: event.target.value })}
            aria-label="Posted from"
            className="w-36"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setParams({ to: event.target.value })}
            aria-label="Posted until"
            className="w-36"
          />
        </div>

        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery('');
              setParams({ q: null, status: null, platform: null, from: null, to: null, product: null });
            }}
          >
            Clear filters
          </Button>
        )}
      </PageToolbar>

      <PageBody>
        {result.rows.length === 0 ? (
          <EmptyState
            variant="filtered"
            title="No posts match those filters"
            description="Try a different status, platform or date range."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setQuery('');
                  setParams({ q: null, status: null, platform: null, from: null, to: null, product: null });
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableColumnHeader>Post</TableColumnHeader>
                    <TableColumnHeader>Destination</TableColumnHeader>
                    <TableColumnHeader>Status</TableColumnHeader>
                    <TableColumnHeader>Created</TableColumnHeader>
                    <TableColumnHeader>Published</TableColumnHeader>
                    <TableColumnHeader className="text-right">Actions</TableColumnHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.rows.map((post) => (
                    /* The whole row opens the post, and the product name is a
                     * real link too, so middle-click and the keyboard both
                     * work (AGENTS.md §3). */
                    <TableRow
                      key={post.id}
                      clickable
                      onClick={() => router.push(`/social/posts/${post.id}`)}
                    >
                      <TableCell>
                        <div className="flex items-start gap-3">
                          {post.imageUrls[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={post.imageUrls[0]} alt="" className="size-10 shrink-0 rounded object-cover" />
                          ) : (
                            <span className="size-10 shrink-0 rounded bg-muted" />
                          )}
                          <div className="min-w-0 max-w-sm">
                            <Link
                              href={`/social/posts/${post.id}`}
                              onClick={(event) => event.stopPropagation()}
                              className="block truncate text-sm font-medium text-foreground hover:underline"
                            >
                              {post.productName ?? 'Untitled post'}
                            </Link>
                            <p className="truncate text-xs text-muted-foreground">{post.caption}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <PlatformIcon platform={post.platform} className="size-4 text-muted-foreground" />
                          <div className="min-w-0">
                            <div className="truncate text-sm text-foreground">{post.accountName}</div>
                            <div className="text-xs text-muted-foreground">{PLATFORM_LABELS[post.platform]}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANTS[post.status]} dot>
                          {POST_STATUS_LABELS[post.status]}
                        </Badge>
                        {post.problem && (
                          <p className="mt-1 max-w-xs text-xs text-muted-foreground">{post.problem}</p>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">{formatDate(post.createdAt)}</TableCell>
                      <TableCell className="tabular-nums">
                        {post.publishedAt ? formatDate(post.publishedAt) : '—'}
                      </TableCell>
                      <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {post.externalUrl && (
                            <Button variant="ghost" size="sm" asChild>
                              <a href={post.externalUrl} target="_blank" rel="noreferrer">
                                <ExternalLink className="size-4" />
                                View
                              </a>
                            </Button>
                          )}
                          {canManage && (post.status === 'FAILED' || post.status === 'DRAFT') && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRetry(post)}
                                disabled={retrying === post.id}
                              >
                                {retrying === post.id ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="size-4" />
                                )}
                                Try again
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDiscarding(post)}
                                aria-label={`Remove ${post.productName ?? 'post'} from history`}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>

            {result.pageCount > 1 && (
              <TablePagination
                page={result.page}
                totalPages={result.pageCount}
                totalItems={result.total}
                pageSize={result.perPage}
                onPageChange={(next) => setParams({ page: String(next) })}
              />
            )}
          </>
        )}
      </PageBody>

      <AlertDialogRoot open={discarding !== null} onOpenChange={(open) => !open && setDiscarding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this post from your history?</AlertDialogTitle>
            <AlertDialogDescription>
              This only forgets MansaaS’s record of{' '}
              {discarding?.status === 'DRAFT' ? 'this unsent draft' : 'this failed attempt'}. Nothing is deleted from
              Facebook or Instagram, and you won’t be able to retry it afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <Button variant="destructive" onClick={handleDiscard} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Remove from history
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </div>
  );
}
