'use client';

/*
 * Post history.
 *
 * One row per post, with the two things that matter afterwards: did it go
 * out, and if not, why. A failed post keeps its caption, images and
 * destination, so "Try again" is a real retry of that record rather than an
 * invitation to type it all out once more.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ExternalLink, Loader2, RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { PlatformIcon } from '@/components/social/platform-icon';
import { SocialNav } from '@/components/social/social-nav';
import { formatDate } from '@/lib/format';
import { retrySocialPost } from '@/features/social/posts';
import {
  PLATFORM_LABELS,
  POST_STATUS_LABELS,
  type SocialPostRow,
  type SocialPostStatus,
} from '@/lib/social/types';

const STATUS_VARIANTS: Record<SocialPostStatus, 'success' | 'warning' | 'destructive' | 'muted'> = {
  PUBLISHED: 'success',
  PUBLISHING: 'warning',
  FAILED: 'destructive',
  DRAFT: 'muted',
};

const PAGE_SIZE = 20;

export function PostHistoryClient({ posts, canManage }: { posts: SocialPostRow[]; canManage: boolean }) {
  const router = useRouter();
  const [status, setStatus] = React.useState('all');
  const [page, setPage] = React.useState(1);
  const [retrying, setRetrying] = React.useState<string | null>(null);

  const filtered = React.useMemo(
    () => (status === 'all' ? posts : posts.filter((post) => post.status === status)),
    [posts, status],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  async function handleRetry(post: SocialPostRow) {
    setRetrying(post.id);
    const result = await retrySocialPost(post.id);
    setRetrying(null);

    if (!result.success) {
      toast.error(result.error);
      router.refresh();
      return;
    }
    toast.success(`Published to ${result.data.accountName}`);
    router.refresh();
  }

  const header = (
    <>
      <PageHeader
        title="Post history"
        description="Every post you’ve sent to a social account from MansaaS."
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

  if (posts.length === 0) {
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
        <SelectRoot
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
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
      </PageToolbar>

      <PageBody>
        {visible.length === 0 ? (
          <EmptyState
            variant="filtered"
            title="No posts with that status"
            description="Try a different status."
            action={
              <Button variant="outline" onClick={() => setStatus('all')}>
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
                    <TableColumnHeader className="text-right">Actions</TableColumnHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visible.map((post) => (
                    <TableRow key={post.id}>
                      <TableCell>
                        <div className="flex items-start gap-3">
                          {post.imageUrls[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={post.imageUrls[0]} alt="" className="size-10 shrink-0 rounded object-cover" />
                          ) : (
                            <span className="size-10 shrink-0 rounded bg-muted" />
                          )}
                          <div className="min-w-0 max-w-sm">
                            <div className="truncate text-sm font-medium text-foreground">
                              {post.productName ?? '—'}
                            </div>
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
                      <TableCell className="text-right">
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
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>

            {totalPages > 1 && (
              <TablePagination
                page={currentPage}
                totalPages={totalPages}
                totalItems={filtered.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            )}
          </>
        )}
      </PageBody>
    </div>
  );
}
