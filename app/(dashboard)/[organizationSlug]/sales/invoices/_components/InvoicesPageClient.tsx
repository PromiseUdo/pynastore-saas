'use client';

/*
 * Sales → Invoices.
 *
 * The list, and the one thing a merchant comes here to know: who still owes
 * money. Overdue rows say how late they are rather than only wearing a badge,
 * and the row itself opens the invoice.
 *
 * Creating one is a page now, not a dialog: a form with line items belongs on
 * a page (AGENTS §4), and the dialog had to be handed every customer and
 * every product in the workspace to fill its dropdowns.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Plus, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader, PageBody, PageToolbar } from '@/components/layout/page-header';
import { PageTabs } from '@/components/layout/page-tabs';
import { EmptyState } from '@/components/layout/empty-state';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from '@/components/ui/table';
import { enumLabel, formatDate, formatMoney } from '@/lib/format';
import type { InvoiceListRow } from '@/features/sales/actions';

type InvoicesPageClientProps = {
  invoices: InvoiceListRow[];
  /** `overdue` narrows the list server-side (?view=overdue). */
  view: 'all' | 'overdue';
  canCreate: boolean;
};

const STATUS_VARIANT: Record<InvoiceListRow['status'], 'draft' | 'pending' | 'approved' | 'completed' | 'rejected' | 'muted'> = {
  DRAFT: 'draft',
  SENT: 'pending',
  PARTIALLY_PAID: 'approved',
  PAID: 'completed',
  OVERDUE: 'rejected',
  VOID: 'muted',
  WRITTEN_OFF: 'muted',
};

/** "12 days late" is actionable; "Overdue" is only a colour with a word on it. */
function daysLate(dueDate: Date | string | null): number | null {
  if (!dueDate) return null;
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86_400_000);
  return days > 0 ? days : null;
}

export function InvoicesPageClient({ invoices, view, canCreate }: InvoicesPageClientProps) {
  const router = useRouter();

  const newInvoiceButton = canCreate ? (
    <Button asChild size="sm">
      <Link href="/sales/invoices/new">
        <Plus className="size-3.5" />
        New invoice
      </Link>
    </Button>
  ) : undefined;

  const owed = invoices
    .filter((inv) => inv.status !== 'VOID' && inv.status !== 'WRITTEN_OFF')
    .reduce((sum, inv) => sum + (inv.totalAmount - inv.paidAmount), 0);
  const overdueCount = invoices.filter((inv) => inv.isOverdue).length;
  const showingOverdue = view === 'overdue';

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Bill customers and keep track of what you're owed."
        actions={newInvoiceButton}
      />

      <PageToolbar>
        <PageTabs
          tabs={[
            { key: 'all', label: 'All invoices' },
            { key: 'overdue', label: showingOverdue ? `Overdue (${invoices.length})` : 'Overdue' },
          ]}
          current={view}
        />
      </PageToolbar>

      <PageBody>
        {invoices.length === 0 && showingOverdue ? (
          <EmptyState
            variant="filtered"
            icon={CheckCircle2}
            title="Nothing is overdue"
            description="Every sent invoice is either paid or still within its due date."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/sales/invoices">Show all invoices</Link>
              </Button>
            }
          />
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No invoices yet"
            description="An invoice bills a customer for goods or work. Create one directly, or convert a quote the customer has accepted."
            action={newInvoiceButton}
          />
        ) : (
          <>
            {/* What the list adds up to, before the list itself. */}
            {owed > 0 && (
              <p className="mb-4 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{formatMoney(owed)}</span>{' '}
                {showingOverdue ? 'outstanding on overdue invoices' : 'outstanding'}
                {!showingOverdue && overdueCount > 0 && (
                  <>
                    {' · '}
                    <Link
                      href="/sales/invoices?view=overdue"
                      className="font-medium text-destructive underline-offset-4 hover:underline"
                    >
                      {overdueCount} {overdueCount === 1 ? 'invoice is' : 'invoices are'} overdue
                    </Link>
                  </>
                )}
              </p>
            )}

            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableColumnHeader>Invoice</TableColumnHeader>
                    <TableColumnHeader>Customer</TableColumnHeader>
                    <TableColumnHeader>Status</TableColumnHeader>
                    <TableColumnHeader align="right">Total</TableColumnHeader>
                    <TableColumnHeader align="right">Outstanding</TableColumnHeader>
                    <TableColumnHeader>Due</TableColumnHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {invoices.map((inv) => {
                    const late = inv.isOverdue ? daysLate(inv.dueDate) : null;
                    const outstanding = inv.totalAmount - inv.paidAmount;
                    return (
                      <TableRow
                        key={inv.id}
                        clickable
                        onClick={() => router.push(`/sales/invoices/${inv.id}`)}
                      >
                        <TableCell>
                          <Link
                            href={`/sales/invoices/${inv.id}`}
                            onClick={(event) => event.stopPropagation()}
                            className="font-medium tabular-nums text-foreground hover:underline"
                          >
                            {inv.invoiceNumber}
                          </Link>
                        </TableCell>
                        <TableCell muted>{inv.customerName}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Badge variant={STATUS_VARIANT[inv.status]}>{enumLabel(inv.status)}</Badge>
                            {late && <Badge variant="destructive">{late === 1 ? '1 day late' : `${late} days late`}</Badge>}
                          </div>
                        </TableCell>
                        <TableCell align="right" className="tabular-nums">
                          {formatMoney(inv.totalAmount, inv.currency)}
                        </TableCell>
                        <TableCell align="right" className="tabular-nums">
                          {outstanding > 0 ? (
                            <span className="font-medium">{formatMoney(outstanding, inv.currency)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell muted className="tabular-nums">
                          {inv.dueDate ? formatDate(inv.dueDate) : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableWrapper>
          </>
        )}
      </PageBody>
    </>
  );
}
