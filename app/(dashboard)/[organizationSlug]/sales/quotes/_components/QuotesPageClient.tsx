'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
  TableEmpty,
} from '@/components/ui/table';
import { CreateQuoteDialog } from './CreateQuoteDialog';
import type { QuoteListRow, CustomerRow } from '@/features/sales/actions';
import type { ItemListRow } from '@/features/inventory/actions';

type QuotesPageClientProps = {
  quotes: QuoteListRow[];
  customers: CustomerRow[];
  items: ItemListRow[];
  canCreate: boolean;
};

const STATUS_VARIANT: Record<QuoteListRow['status'], 'draft' | 'pending' | 'approved' | 'rejected' | 'completed' | 'muted'> = {
  DRAFT: 'draft',
  SENT: 'pending',
  ACCEPTED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'muted',
  CONVERTED: 'completed',
};

export function QuotesPageClient({ quotes, customers, items, canCreate }: QuotesPageClientProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = React.useState(false);

  return (
    <>
      <div className="flex items-center justify-between border-b bg-background px-6 py-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Quotes</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Draft, send, and convert quotes into invoices.</p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={customers.length === 0}>
            <Plus className="size-3.5" />
            New quote
          </Button>
        )}
      </div>

      <div className="px-6 py-6">
        {quotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
            <FileText className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No quotes yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {customers.length === 0 ? 'Add a customer first, then create a quote.' : 'Create a quote to start a sale.'}
            </p>
          </div>
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Quote #</TableColumnHeader>
                  <TableColumnHeader>Customer</TableColumnHeader>
                  <TableColumnHeader>Status</TableColumnHeader>
                  <TableColumnHeader align="right">Total</TableColumnHeader>
                  <TableColumnHeader>Valid until</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {quotes.length === 0 ? (
                  <TableEmpty colSpan={5} />
                ) : (
                  quotes.map((q) => (
                    <TableRow key={q.id} clickable onClick={() => router.push(`/sales/quotes/${q.id}`)}>
                      <TableCell className="font-medium text-foreground">{q.quoteNumber}</TableCell>
                      <TableCell muted>{q.customerName}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={STATUS_VARIANT[q.status]}>{q.status}</Badge>
                          {q.isExpired && <Badge variant="destructive">Expired</Badge>}
                        </div>
                      </TableCell>
                      <TableCell align="right">
                        {q.currency} {q.totalAmount.toFixed(2)}
                      </TableCell>
                      <TableCell muted>{q.validUntil ? new Date(q.validUntil).toLocaleDateString() : '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      <CreateQuoteDialog open={createOpen} onOpenChange={setCreateOpen} customers={customers} items={items} />
    </>
  );
}
