'use client';

/*
 * The store's reviews, newest first.
 *
 * A merchant reads this page for two reasons: to see what people are saying,
 * and to deal with the occasional one that shouldn't be public. So the whole
 * review is on screen — not a truncated line that has to be opened — with
 * the product, the rating and the order it came from beside it.
 *
 * Hiding asks for a reason and warns that it changes the product's rating,
 * because it does. Nothing here can edit or delete a customer's words.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { EyeOff, Loader2, MessagesSquare, RotateCcw, Search, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { StatCard, StatGrid } from '@/components/dashboard/stat-card';
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
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { formatDate, formatNumber } from '@/lib/format';
import {
  hideReview,
  restoreReview,
  type ReviewListSummary,
  type ReviewRow,
  type ReviewStatusFilter,
} from '@/features/sales/reviews';

const PAGE_SIZE = 20;

export function ReviewsPageClient({
  rows,
  summary,
  status,
  query,
  canModerate,
}: {
  rows: ReviewRow[];
  summary: ReviewListSummary;
  status: ReviewStatusFilter;
  query: string;
  canModerate: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [hiding, setHiding] = React.useState<ReviewRow | null>(null);
  const [reason, setReason] = React.useState('');
  const [pending, setPending] = React.useState(false);

  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  /* Search, filter and page live in the URL: a refresh, a bookmark or a link
   * to a colleague all land on the same list. */
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

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const filtering = status !== 'all' || query.trim().length > 0;

  async function confirmHide() {
    if (!hiding) return;
    setPending(true);
    const result = await hideReview(hiding.id, reason);
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Review hidden — it’s off your store and out of the product’s rating');
    setHiding(null);
    setReason('');
    router.refresh();
  }

  async function restore(row: ReviewRow) {
    const result = await restoreReview(row.id);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Review is back on your store');
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Reviews"
        description="What customers wrote about products after their orders were delivered. Only customers can write these — you can hide one that breaks your rules."
      />

      {summary.total > 0 && (
        <PageToolbar>
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search reviews"
              placeholder="Search reviews, products or customers"
              defaultValue={query}
              onChange={(e) => setParams({ q: e.target.value })}
              className="pl-8"
            />
          </div>
          <SelectRoot
            value={status}
            onValueChange={(value) => setParams({ status: value === 'all' ? null : value })}
          >
            <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reviews</SelectItem>
              <SelectItem value="published">On your store</SelectItem>
              <SelectItem value="hidden">Hidden</SelectItem>
            </SelectContent>
          </SelectRoot>
        </PageToolbar>
      )}

      <PageBody>
        {summary.total > 0 && (
          <StatGrid className="mb-6 lg:grid-cols-3">
            <StatCard
              title="Average rating"
              value={summary.published > 0 ? summary.average.toFixed(1) : '—'}
              description={
                summary.published > 0
                  ? `Across ${formatNumber(summary.published, 0)} ${summary.published === 1 ? 'review' : 'reviews'} on your store`
                  : 'Nothing published yet'
              }
              icon={Star}
            />
            <StatCard
              title="On your store"
              value={formatNumber(summary.published, 0)}
              description="Visible to shoppers and counted in product ratings"
              icon={MessagesSquare}
            />
            <StatCard
              title="Hidden"
              value={formatNumber(summary.hidden, 0)}
              description="Off your store and out of every rating"
              icon={EyeOff}
            />
          </StatGrid>
        )}

        {rows.length === 0 ? (
          filtering ? (
            <EmptyState
              variant="filtered"
              title="No reviews match"
              description="Nothing here fits that search or filter."
              action={
                <Button size="sm" variant="outline" onClick={() => setParams({ q: null, status: null })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={MessagesSquare}
              title="No reviews yet"
              description="A customer can review a product once their order has been marked delivered. Keeping your orders up to date is what opens the form for them."
              action={
                <Button size="sm" variant="outline" asChild>
                  <Link href="../orders">Go to orders</Link>
                </Button>
              }
            />
          )
        ) : (
          <>
            <ul className="space-y-3">
              {visible.map((row) => (
                <li
                  key={row.id}
                  className="rounded-md border bg-card p-4 data-[hidden=true]:bg-muted/40"
                  data-hidden={row.status === 'HIDDEN'}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums">
                          {row.rating}
                          <Star aria-hidden className="size-3.5 fill-amber-400 text-amber-400" />
                        </span>
                        <h3 className="text-sm font-semibold">{row.title}</h3>
                        <Badge variant={row.status === 'HIDDEN' ? 'warning' : 'success'}>
                          {row.status === 'HIDDEN' ? 'Hidden' : 'On your store'}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.productName} · {row.customerName} · order {row.orderReference} ·{' '}
                        {formatDate(row.createdAt)}
                        {row.helpfulCount > 0 && ` · ${formatNumber(row.helpfulCount, 0)} found it helpful`}
                      </p>
                    </div>

                    {canModerate && (
                      <div className="shrink-0">
                        {row.status === 'HIDDEN' ? (
                          <Button size="sm" variant="outline" onClick={() => void restore(row)}>
                            <RotateCcw className="size-3.5" />
                            Restore
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setHiding(row);
                              setReason('');
                            }}
                          >
                            <EyeOff className="size-3.5" />
                            Hide
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  <p className="mt-3 text-sm whitespace-pre-line">{row.body}</p>

                  {row.status === 'HIDDEN' && row.hiddenReason && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Hidden because: {row.hiddenReason}
                    </p>
                  )}
                </li>
              ))}
            </ul>

            <TablePagination
              page={currentPage}
              totalPages={totalPages}
              totalItems={rows.length}
              pageSize={PAGE_SIZE}
              onPageChange={(next) => setParams({ page: String(next) })}
            />
          </>
        )}
      </PageBody>

      <AlertDialogRoot open={hiding !== null} onOpenChange={(open) => !open && setHiding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hide this review?</AlertDialogTitle>
            <AlertDialogDescription>
              It comes off your store straight away and stops counting towards{' '}
              {hiding?.productName ?? 'the product'}’s rating. The customer isn’t told, and you can
              put it back at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="hide-reason">Why are you hiding it?</Label>
            <Textarea
              id="hide-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={200}
              placeholder="e.g. Contains a customer’s phone number"
            />
            <p className="text-xs text-muted-foreground">
              For your records only — this is never shown to shoppers.
            </p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <Button variant="destructive" onClick={() => void confirmHide()} disabled={pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Hide review
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </>
  );
}
