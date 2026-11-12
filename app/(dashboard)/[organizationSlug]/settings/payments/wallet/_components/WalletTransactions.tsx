'use client';

/*
 * The shop wallet's transactions, a page at a time; the page lives in the
 * URL (?page=) so it survives a refresh and can be shared.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeftRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/layout/empty-state';
import { Table, TableBody, TableCell, TableColumnHeader, TableHead, TableRow, TableWrapper } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { buttonVariants } from '@/components/ui/button';
import { enumLabel, formatDate, formatMoney } from '@/lib/format';
import type { WalletTransaction } from '@/lib/wallet/edupay';

type BadgeVariant = 'success' | 'pending' | 'destructive' | 'draft';

function statusBadge(status: string | null): { variant: BadgeVariant; label: string } | null {
  if (!status) return null;
  if (status === 'completed' || status === 'success' || status === 'successful') return { variant: 'success', label: 'Completed' };
  if (status === 'pending' || status === 'processing') return { variant: 'pending', label: 'Pending' };
  if (status === 'failed' || status === 'reversed' || status === 'cancelled') return { variant: 'destructive', label: enumLabel(status.toUpperCase()) };
  return { variant: 'draft', label: enumLabel(status.toUpperCase()) };
}

export function WalletTransactions({
  transactions,
  total,
  page,
  pageSize,
  currency,
}: {
  /** null: EduPay didn't answer */
  transactions: WalletTransaction[] | null;
  total: number;
  page: number;
  pageSize: number;
  currency: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function goTo(next: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (next > 1) params.set('page', String(next));
    else params.delete('page');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Transactions</h2>
      </div>

      {transactions === null ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="We couldn’t load your transactions"
          description="EduPay didn’t answer just now. Your money is safe; this is only the list."
          action={
            <a href={pathname} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Try again
            </a>
          }
        />
      ) : transactions.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No transactions yet"
          description="Payments into your wallet, refunds and payouts will be listed here."
        />
      ) : (
        <>
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Date</TableColumnHeader>
                  <TableColumnHeader>Description</TableColumnHeader>
                  <TableColumnHeader>Reference</TableColumnHeader>
                  <TableColumnHeader>Status</TableColumnHeader>
                  <TableColumnHeader align="right">Amount</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {transactions.map((tx) => {
                  const badge = statusBadge(tx.status);
                  const credit = tx.direction === 'credit';
                  return (
                    <TableRow key={tx.reference}>
                      <TableCell className="whitespace-nowrap tabular-nums">{tx.createdAt ? formatDate(tx.createdAt) : '—'}</TableCell>
                      <TableCell>{tx.description ?? (credit ? 'Money in' : 'Money out')}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{tx.reference}</TableCell>
                      <TableCell>{badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : '—'}</TableCell>
                      <TableCell align="right" className="whitespace-nowrap tabular-nums">
                        <span className="sr-only">{credit ? 'In' : 'Out'} </span>
                        {credit ? '+' : '−'}
                        {formatMoney(tx.amountKobo / 100, currency)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableWrapper>
          {total > pageSize && (
            <TablePagination
              page={page}
              totalPages={Math.ceil(total / pageSize)}
              totalItems={total}
              pageSize={pageSize}
              onPageChange={goTo}
            />
          )}
        </>
      )}
    </section>
  );
}
