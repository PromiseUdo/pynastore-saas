'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
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
} from '@/components/ui/table';
import { ConvertToInvoiceDialog } from './ConvertToInvoiceDialog';
import { sendQuote, acceptQuote, rejectQuote, type QuoteDetail } from '@/features/sales/actions';
import type { WarehouseRow } from '@/features/inventory/actions';
import { enumLabel, formatMoney } from '@/lib/format';

type QuoteDetailClientProps = {
  quote: QuoteDetail;
  warehouses: WarehouseRow[];
  can: { edit: boolean; convert: boolean };
};

const STATUS_VARIANT: Record<QuoteDetail['status'], 'draft' | 'pending' | 'approved' | 'rejected' | 'completed' | 'muted'> = {
  DRAFT: 'draft',
  SENT: 'pending',
  ACCEPTED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'muted',
  CONVERTED: 'completed',
};

export function QuoteDetailClient({ quote, warehouses, can }: QuoteDetailClientProps) {
  const router = useRouter();
  const [isPending, setIsPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [convertOpen, setConvertOpen] = React.useState(false);

  async function runAction(action: () => Promise<{ success: boolean; error?: string }>) {
    setIsPending(true);
    setError(null);
    const result = await action();
    setIsPending(false);
    if (!result.success) {
      setError(result.error ?? 'Something went wrong');
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between border-b bg-background px-6 py-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">{quote.quoteNumber}</h1>
            <Badge variant={STATUS_VARIANT[quote.status]}>{enumLabel(quote.status)}</Badge>
            {quote.isExpired && <Badge variant="destructive">Expired</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{quote.customerName}</p>
        </div>
        <div className="flex items-center gap-2">
          {quote.status === 'DRAFT' && can.edit && (
            <Button size="sm" onClick={() => runAction(() => sendQuote(quote.id))} disabled={isPending}>
              Send
            </Button>
          )}
          {quote.status === 'SENT' && can.edit && (
            <>
              <Button variant="outline" size="sm" onClick={() => runAction(() => rejectQuote(quote.id))} disabled={isPending}>
                Reject
              </Button>
              <Button size="sm" onClick={() => runAction(() => acceptQuote(quote.id))} disabled={isPending}>
                Accept
              </Button>
            </>
          )}
          {quote.status === 'ACCEPTED' && can.convert && (
            <Button size="sm" onClick={() => setConvertOpen(true)} disabled={isPending}>
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              Convert to invoice
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4 px-6 py-6">
        {error && <p className="text-sm text-destructive">{error}</p>}

        <TableWrapper>
          <Table>
            <TableHead>
              <TableRow>
                <TableColumnHeader>Item</TableColumnHeader>
                <TableColumnHeader align="right">Qty</TableColumnHeader>
                <TableColumnHeader align="right">Unit price</TableColumnHeader>
                <TableColumnHeader align="right">Total</TableColumnHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {quote.lineItems.map((li) => (
                <TableRow key={li.id}>
                  <TableCell className="font-medium text-foreground">{li.description}</TableCell>
                  <TableCell align="right">{li.quantity}</TableCell>
                  <TableCell align="right" muted>
                    {formatMoney(li.unitPrice, quote.currency)}
                  </TableCell>
                  <TableCell align="right">{formatMoney(li.totalPrice, quote.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrapper>

        <div className="flex justify-end gap-8 text-sm">
          <span className="text-muted-foreground">Subtotal: {formatMoney(quote.subtotal, quote.currency)}</span>
          <span className="text-muted-foreground">Tax: {formatMoney(quote.taxAmount, quote.currency)}</span>
          <span className="font-semibold text-foreground">Total: {formatMoney(quote.totalAmount, quote.currency)}</span>
        </div>

        {quote.notes && (
          <div className="rounded-lg border bg-card px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">Notes</p>
            <p className="mt-1 text-sm text-foreground">{quote.notes}</p>
          </div>
        )}
      </div>

      <ConvertToInvoiceDialog open={convertOpen} onOpenChange={setConvertOpen} quoteId={quote.id} warehouses={warehouses} />
    </>
  );
}
