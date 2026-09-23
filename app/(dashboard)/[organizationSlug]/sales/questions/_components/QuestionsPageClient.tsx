'use client';

/*
 * The store's product questions, waiting ones first.
 *
 * A merchant opens this page to do one thing: answer. So the answer box is
 * on the row itself rather than behind a dialog, and the button says what
 * happens — "Publish answer" — because that is the moment the question and
 * the answer appear on the product page.
 *
 * Nothing here can edit a customer's words. Hiding asks for a reason and
 * keeps the row, so the decision is reversible and on the record.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { EyeOff, HelpCircle, Loader2, MessagesSquare, RotateCcw, Search, Send } from 'lucide-react';
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
import { ANSWER_MAX } from '@/lib/storefront/questions';
import {
  answerQuestion,
  hideQuestion,
  restoreQuestion,
  type QuestionListSummary,
  type QuestionRow,
  type QuestionStatusFilter,
} from '@/features/sales/questions';

const PAGE_SIZE = 20;

const STATUS_BADGE: Record<QuestionRow['status'], { label: string; variant: 'warning' | 'success' | 'draft' }> = {
  PENDING: { label: 'Waiting for you', variant: 'warning' },
  ANSWERED: { label: 'On your store', variant: 'success' },
  HIDDEN: { label: 'Hidden', variant: 'draft' },
};

export function QuestionsPageClient({
  rows,
  summary,
  status,
  query,
  canAnswer,
}: {
  rows: QuestionRow[];
  summary: QuestionListSummary;
  status: QuestionStatusFilter;
  query: string;
  canAnswer: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [openAnswer, setOpenAnswer] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const [hiding, setHiding] = React.useState<QuestionRow | null>(null);
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

  function startAnswering(row: QuestionRow) {
    setOpenAnswer(row.id);
    setDraft(row.answerBody ?? '');
  }

  async function publishAnswer(row: QuestionRow) {
    setSaving(true);
    const result = await answerQuestion(row.id, draft);
    setSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(
      row.status === 'ANSWERED'
        ? 'Answer updated on your store'
        : 'Answered — the question and your answer are now on the product page',
    );
    setOpenAnswer(null);
    setDraft('');
    router.refresh();
  }

  async function confirmHide() {
    if (!hiding) return;
    setPending(true);
    const result = await hideQuestion(hiding.id, reason);
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Question hidden — it won’t appear on your store');
    setHiding(null);
    setReason('');
    router.refresh();
  }

  async function restore(row: QuestionRow) {
    const result = await restoreQuestion(row.id);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(
      row.answerBody ? 'Question is back on your store' : 'Question is back in your queue',
    );
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Questions"
        description="What shoppers asked about your products. A question only appears on your store once you answer it."
      />

      {summary.total > 0 && (
        <PageToolbar>
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search questions"
              placeholder="Search questions, products or customers"
              defaultValue={query}
              onChange={(e) => setParams({ q: e.target.value })}
              className="pl-8"
            />
          </div>
          <SelectRoot
            value={status}
            onValueChange={(value) => setParams({ status: value === 'all' ? null : value })}
          >
            <SelectTrigger className="w-full sm:w-48" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All questions</SelectItem>
              <SelectItem value="pending">Waiting for you</SelectItem>
              <SelectItem value="answered">On your store</SelectItem>
              <SelectItem value="hidden">Hidden</SelectItem>
            </SelectContent>
          </SelectRoot>
        </PageToolbar>
      )}

      <PageBody>
        {summary.total > 0 && (
          <StatGrid className="mb-6 lg:grid-cols-3">
            <StatCard
              title="Waiting for you"
              value={formatNumber(summary.pending, 0)}
              description="Asked by shoppers, not yet on your store"
              icon={HelpCircle}
            />
            <StatCard
              title="On your store"
              value={formatNumber(summary.answered, 0)}
              description="Answered and visible on the product page"
              icon={MessagesSquare}
            />
            <StatCard
              title="Hidden"
              value={formatNumber(summary.hidden, 0)}
              description="Kept off your store — the record stays here"
              icon={EyeOff}
            />
          </StatGrid>
        )}

        {rows.length === 0 ? (
          filtering ? (
            <EmptyState
              variant="filtered"
              title="No questions match"
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
              title="No questions yet"
              description="Signed-in shoppers can ask about a product from its page on your store. Anything they ask lands here for you to answer."
              action={
                <Button size="sm" variant="outline" asChild>
                  <Link href="../../inventory/products">Go to products</Link>
                </Button>
              }
            />
          )
        ) : (
          <>
            <ul className="space-y-3">
              {visible.map((row) => {
                const badge = STATUS_BADGE[row.status];
                const answering = openAnswer === row.id;

                return (
                  <li
                    key={row.id}
                    className="rounded-md border bg-card p-4 data-[hidden=true]:bg-muted/40"
                    data-hidden={row.status === 'HIDDEN'}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold">{row.body}</h3>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.productName} · {row.customerName} · asked {formatDate(row.createdAt)}
                        </p>
                      </div>

                      {canAnswer && !answering && (
                        <div className="flex shrink-0 flex-wrap gap-2">
                          {row.status === 'HIDDEN' ? (
                            <Button size="sm" variant="outline" onClick={() => void restore(row)}>
                              <RotateCcw className="size-3.5" />
                              Restore
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant={row.status === 'PENDING' ? 'default' : 'outline'}
                                onClick={() => startAnswering(row)}
                              >
                                <Send className="size-3.5" />
                                {row.status === 'PENDING' ? 'Answer' : 'Edit answer'}
                              </Button>
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
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {row.answerBody && !answering && (
                      <div className="mt-3 rounded-md border bg-muted/40 p-3">
                        <p className="text-sm whitespace-pre-line">{row.answerBody}</p>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Answered{row.answeredByName ? ` by ${row.answeredByName}` : ''}
                          {row.answeredAt ? ` · ${formatDate(row.answeredAt)}` : ''} · shown to
                          shoppers as “Store team”
                        </p>
                      </div>
                    )}

                    {answering && (
                      <div className="mt-3 space-y-2">
                        <Label htmlFor={`answer-${row.id}`}>Your answer</Label>
                        <Textarea
                          id={`answer-${row.id}`}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          rows={4}
                          maxLength={ANSWER_MAX}
                          placeholder="Answer in your own words — this goes on the product page."
                        />
                        <p className="text-xs text-muted-foreground">
                          Published on {row.productName}’s page under “Store team”, next to the
                          question. Only say what you can stand behind — it’s a promise to every
                          shopper who reads it.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => void publishAnswer(row)} disabled={saving}>
                            {saving && <Loader2 className="size-3.5 animate-spin" />}
                            {row.status === 'ANSWERED' ? 'Update answer' : 'Publish answer'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setOpenAnswer(null)}
                            disabled={saving}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {row.status === 'HIDDEN' && row.hiddenReason && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Hidden because: {row.hiddenReason}
                      </p>
                    )}

                    {row.status === 'PENDING' && !answering && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Waiting for an answer — only {row.customerName.split(' ')[0]} can see this
                        question until you answer it.
                      </p>
                    )}
                  </li>
                );
              })}
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
            <AlertDialogTitle>Hide this question?</AlertDialogTitle>
            <AlertDialogDescription>
              It stays off {hiding?.productName ?? 'the product'}’s page, and any answer on it comes
              down too. The customer isn’t told, and you can put it back at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="hide-question-reason">Why are you hiding it?</Label>
            <Textarea
              id="hide-question-reason"
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
              Hide question
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </>
  );
}
