/*
 * Social Commerce → Post history → one post.
 *
 * The whole record of one post: where it went, what it said, which product
 * it came from, and what happened. A failed post shows the reason and keeps
 * its retry; a published one links out to the real thing when Meta gave us a
 * link, and otherwise names the id it returned rather than guessing at a URL.
 *
 * Everything on this page came from `getSocialPost`, which pairs the post id
 * with the organization from the session — so another store's post id is a
 * 404 here, not somebody else's caption.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ChevronLeft, ExternalLink, Package } from 'lucide-react';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PlatformIcon } from '@/components/social/platform-icon';
import { SocialNav } from '@/components/social/social-nav';
import { formatDate } from '@/lib/format';
import { getSocialPost } from '@/features/social/posts';
import {
  PLATFORM_LABELS,
  POST_STATUS_LABELS,
  type SocialPostStatus,
} from '@/lib/social/types';
import { PostDetailActions } from './_components/PostDetailActions';

export const metadata: Metadata = { title: 'Post' };

const STATUS_VARIANTS: Record<SocialPostStatus, 'success' | 'warning' | 'destructive' | 'muted'> = {
  PUBLISHED: 'success',
  PUBLISHING: 'warning',
  FAILED: 'destructive',
  DRAFT: 'muted',
};

/** Where this post is in its life, in one line under the status badge. */
function nextStepHint(status: SocialPostStatus): string {
  switch (status) {
    case 'PUBLISHED':
      return 'This post is live on the account it was sent to.';
    case 'PUBLISHING':
      return 'We’re sending this to the platform now. Refresh in a moment.';
    case 'FAILED':
      return 'Nothing was posted. Fix the problem below, then try again.';
    case 'DRAFT':
      return 'This was never sent. You can publish it or remove it.';
  }
}

export default async function SocialPostDetailPage({ params }: { params: Promise<{ postId: string }> }) {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;

  if (!hasPermission(perms, PERMISSIONS.SOCIAL_VIEW)) return <AccessDenied what="social posts" />;

  const { postId } = await params;
  const result = await getSocialPost(postId);

  /* "Not found" and "the load failed" are different things, and only one of
   * them is the merchant's to fix. A genuine miss is a 404; anything else
   * goes to the boundary, which offers a retry. */
  if (!result.success) {
    if (result.error === 'Post not found') notFound();
    throw new Error(result.error);
  }

  const post = result.data;
  const canManage = hasPermission(perms, PERMISSIONS.SOCIAL_MANAGE);

  return (
    <div>
      <PageHeader
        title={post.productName ?? 'Social post'}
        description={`${PLATFORM_LABELS[post.platform]} · ${post.accountName}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/social/posts"
              className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" />
              All posts
            </Link>
            {post.externalUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={post.externalUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" />
                  View on {post.platform === 'INSTAGRAM_BUSINESS' ? 'Instagram' : 'Facebook'}
                </a>
              </Button>
            )}
            {canManage && (
              <PostDetailActions
                postId={post.id}
                status={post.status}
                label={post.productName ?? 'this post'}
              />
            )}
          </div>
        }
      />
      <SocialNav />

      <PageBody>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
          {/* ── The post itself ─────────────────────────────────────────── */}
          <div className="space-y-4">
            <section className="rounded-lg border bg-card">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold text-foreground">Content</h2>
              <div className="space-y-4 px-4 py-4">
                {post.imageUrls.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {post.imageUrls.map((url) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={url} src={url} alt="" className="size-28 rounded-lg border object-cover" />
                    ))}
                  </div>
                )}

                <div>
                  <h3 className="text-xs font-medium text-muted-foreground">Caption</h3>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{post.caption}</p>
                </div>

                <div>
                  <h3 className="text-xs font-medium text-muted-foreground">Hashtags</h3>
                  <p className="mt-1 break-words text-sm text-foreground">
                    {post.hashtags.length > 0 ? post.hashtags.join(' ') : '—'}
                  </p>
                </div>

                <div>
                  <h3 className="text-xs font-medium text-muted-foreground">Product link in the post</h3>
                  {post.productUrl ? (
                    <a
                      href={post.productUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block break-all text-sm text-primary hover:underline"
                    >
                      {post.productUrl}
                    </a>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">
                      None — the product wasn’t published to the online store when this was posted.
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* Only when there is something to say. */}
            {post.status === 'FAILED' && (
              <section className="rounded-lg border border-destructive/40 bg-card">
                <h2 className="border-b border-destructive/40 px-4 py-2.5 text-sm font-semibold text-foreground">
                  Why it failed
                </h2>
                <div className="space-y-2 px-4 py-4">
                  <p className="text-sm text-foreground">{post.problem ?? 'The platform rejected this post.'}</p>
                  <p className="text-xs text-muted-foreground">
                    {post.attempts} {post.attempts === 1 ? 'attempt' : 'attempts'} so far
                    {post.errorCode ? ` · reference: ${post.errorCode}` : ''}
                  </p>
                </div>
              </section>
            )}
          </div>

          {/* ── The facts around it ─────────────────────────────────────── */}
          <aside className="space-y-4">
            <section className="rounded-lg border bg-card">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold text-foreground">Status</h2>
              <div className="space-y-2 px-4 py-4">
                <Badge variant={STATUS_VARIANTS[post.status]} dot>
                  {POST_STATUS_LABELS[post.status]}
                </Badge>
                <p className="text-xs text-muted-foreground">{nextStepHint(post.status)}</p>

                <dl className="space-y-1.5 pt-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Created</dt>
                    <dd className="tabular-nums text-foreground">{formatDate(post.createdAt)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Published</dt>
                    <dd className="tabular-nums text-foreground">
                      {post.publishedAt ? formatDate(post.publishedAt) : '—'}
                    </dd>
                  </div>
                  {/* Meta's own id, shown only when there's no link to open
                      instead. Never used to build a URL of our own. */}
                  {post.externalPostId && !post.externalUrl && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Post ID</dt>
                      <dd className="break-all text-right font-mono text-xs text-foreground">
                        {post.externalPostId}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </section>

            <section className="rounded-lg border bg-card">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold text-foreground">Posted to</h2>
              <div className="flex items-start gap-3 px-4 py-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <PlatformIcon platform={post.platform} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{post.accountName}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {PLATFORM_LABELS[post.platform]}
                    {post.accountUsername ? ` · @${post.accountUsername}` : ''}
                  </div>
                  {post.accountStatus !== 'ACTIVE' && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      This account needs reconnecting before it can post again.
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-lg border bg-card">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold text-foreground">Product</h2>
              <div className="px-4 py-4">
                <div className="flex items-start gap-3">
                  {post.productImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={post.productImageUrl} alt="" className="size-12 shrink-0 rounded object-cover" />
                  ) : (
                    <span className="flex size-12 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                      <Package className="size-5" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{post.productName ?? '—'}</div>
                    {post.productId ? (
                      <Link
                        href={`/inventory/products/${post.productId}`}
                        className="text-xs text-primary hover:underline"
                      >
                        Open in catalogue
                      </Link>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No longer in your catalogue — the post keeps its name.
                      </p>
                    )}
                  </div>
                </div>

                {post.productId && (
                  <Link
                    href={`/social/posts?product=${post.productId}`}
                    className="mt-3 block text-xs text-muted-foreground hover:text-foreground"
                  >
                    See every post for this product
                  </Link>
                )}
              </div>
            </section>
          </aside>
        </div>
      </PageBody>
    </div>
  );
}
