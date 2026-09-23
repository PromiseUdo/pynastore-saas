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
import { Plus, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader, PageBody } from '@/components/layout/page-header';
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

export function InvoicesPageClient({ invoices, canCreate }: InvoicesPageClientProps) {
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

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Bill customers and keep track of what you're owed."
        actions={newInvoiceButton}
      />

      <PageBody>
        {invoices.length === 0 ? (
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
                <span className="font-medium text-foreground">{formatMoney(owed)}</span> outstanding
                {overdueCount > 0 && (
                  <>
                    {' · '}
                    <span className="font-medium text-destructive">
                      {overdueCount} {overdueCount === 1 ? 'invoice is' : 'invoices are'} overdue
                    </span>
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
