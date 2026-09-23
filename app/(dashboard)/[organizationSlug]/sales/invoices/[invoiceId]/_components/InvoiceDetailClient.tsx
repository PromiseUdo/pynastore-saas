'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
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
import { RecordPaymentDialog } from './RecordPaymentDialog';
import { RequestReturnDialog } from './RequestReturnDialog';
import {
  issueInvoice,
  sendInvoice,
  sendInvoiceReminder,
  voidInvoice,
  type InvoiceDetail,
} from '@/features/sales/actions';
import { enumLabel, formatDate, formatMoney } from '@/lib/format';

type InvoiceDetailClientProps = {
  invoice: InvoiceDetail;
  can: { edit: boolean; void: boolean; return: boolean };
};

const STATUS_VARIANT: Record<InvoiceDetail['status'], 'draft' | 'pending' | 'approved' | 'completed' | 'rejected' | 'muted'> = {
  DRAFT: 'draft',
  SENT: 'pending',
  PARTIALLY_PAID: 'approved',
  PAID: 'completed',
  OVERDUE: 'rejected',
  VOID: 'muted',
  WRITTEN_OFF: 'muted',
};

export function InvoiceDetailClient({ invoice, can }: InvoiceDetailClientProps) {
  const router = useRouter();
  const [isPending, setIsPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = React.useState(false);
  const [returnOpen, setReturnOpen] = React.useState(false);

  const outstanding = invoice.totalAmount - invoice.paidAmount;
  const money = (value: number) => formatMoney(value, invoice.currency);
  const canPay = can.edit && (invoice.status === 'SENT' || invoice.status === 'PARTIALLY_PAID' || invoice.status === 'OVERDUE');
  const canVoid = can.void && ['DRAFT', 'SENT', 'PARTIALLY_PAID'].includes(invoice.status);
  const hasReturnableLines = invoice.lineItems.some((li) => li.quantity - li.returnedQty > 0);
  const canReturn =
    can.return && hasReturnableLines && ['SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'].includes(invoice.status);

  /* Sending is how an invoice reaches anyone. A draft is issued on the way
   * out, so "send" covers both — "Issue without sending" stays for a merchant
   * who wants the stock committed before they write the email. */
  const hasEmail = Boolean(invoice.customerEmail);
  const canSend =
    can.edit && ['DRAFT', 'SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status);
  const canRemind =
    can.edit && Boolean(invoice.sentAt) && ['SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status);

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
            <h1 className="text-lg font-semibold tracking-tight text-foreground">{invoice.invoiceNumber}</h1>
            <Badge variant={STATUS_VARIANT[invoice.status]}>{enumLabel(invoice.status)}</Badge>
            {invoice.isOverdue && <Badge variant="destructive">Overdue</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {invoice.customerName}
            {invoice.warehouseName ? ` · Fulfilled from ${invoice.warehouseName}` : ''}
            {invoice.fulfillmentId && (
              <>
                {' · '}
                <Link href={`/sales/fulfillment/${invoice.fulfillmentId}`} className="text-primary hover:underline">
                  View fulfillment
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {invoice.status === 'DRAFT' && can.edit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAction(() => issueInvoice(invoice.id))}
              disabled={isPending}
            >
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              Issue without sending
            </Button>
          )}
          {canSend && (
            <Button size="sm" onClick={() => runAction(() => sendInvoice(invoice.id))} disabled={isPending || !hasEmail}>
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              <Send className="size-3.5" />
              {invoice.sentAt ? 'Send again' : 'Send to customer'}
            </Button>
          )}
          {canRemind && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAction(() => sendInvoiceReminder(invoice.id))}
              disabled={isPending || !hasEmail}
            >
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              Send reminder
            </Button>
          )}
          {canPay && (
            <Button size="sm" onClick={() => setPaymentOpen(true)} disabled={isPending}>
              Record payment
            </Button>
          )}
          {canReturn && (
            <Button variant="outline" size="sm" onClick={() => setReturnOpen(true)} disabled={isPending}>
              Request return
            </Button>
          )}
          {canVoid && (
            <Button variant="outline" size="sm" onClick={() => runAction(() => voidInvoice(invoice.id))} disabled={isPending}>
              Void
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4 px-6 py-6">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* What the customer has actually been sent, and the link they got.
          * A merchant asked "did they get it?" should not have to guess. */}
        {!hasEmail && can.edit && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/40">
            {invoice.customerName} has no email address, so this invoice can’t be sent.{' '}
            <Link href="/sales/customers" className="font-medium text-primary hover:underline">
              Add one
            </Link>
            .
          </p>
        )}

        {invoice.sentAt && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
            <span>
              Sent to <span className="font-medium text-foreground">{invoice.customerEmail}</span> on{' '}
              {formatDate(invoice.sentAt)}
            </span>
            {invoice.lastReminderAt && <span>· Reminded {formatDate(invoice.lastReminderAt)}</span>}
            {invoice.publicUrl && (
              <>
                <span>·</span>
                <a
                  href={invoice.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  Open the customer’s copy
                </a>
              </>
            )}
            {invoice.status === 'PAID' && (
              <>
                <span>·</span>
                <Link
                  href={`/sales/invoices/${invoice.id}/receipt`}
                  className="font-medium text-primary hover:underline"
                >
                  Receipt
                </Link>
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Total</CardTitle>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {money(invoice.totalAmount)}
              </p>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Paid</CardTitle>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {money(invoice.paidAmount)}
              </p>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Outstanding</CardTitle>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {money(outstanding)}
              </p>
            </CardHeader>
          </Card>
        </div>

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
              {invoice.lineItems.map((li) => (
                <TableRow key={li.id}>
                  <TableCell className="font-medium text-foreground">
                    {li.description}
                    {li.isDropShip && (
                      <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                        {li.dropShipPurchaseOrder ? (
                          <>
                            Drop-ship —{' '}
                            <Link href={`/procurement/purchase-orders/${li.dropShipPurchaseOrder.id}`} className="text-primary hover:underline">
                              {li.dropShipPurchaseOrder.poNumber}
                            </Link>{' '}
                            ({li.dropShipPurchaseOrder.status === 'RECEIVED' ? 'Delivered' : li.dropShipPurchaseOrder.status.replace('_', ' ')})
                          </>
                        ) : (
                          'Drop-ship'
                        )}
                      </p>
                    )}
                  </TableCell>
                  <TableCell align="right">{li.quantity}</TableCell>
                  <TableCell align="right" muted>
                    {money(li.unitPrice)}
                  </TableCell>
                  <TableCell align="right">{money(li.totalPrice)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrapper>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Payment history</h2>
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Date</TableColumnHeader>
                  <TableColumnHeader>Method</TableColumnHeader>
                  <TableColumnHeader>Reference</TableColumnHeader>
                  <TableColumnHeader align="right">Amount</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {invoice.payments.length === 0 ? (
                  <TableEmpty colSpan={4} title="No payments recorded yet" />
                ) : (
                  invoice.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell muted>{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>{p.method.replace('_', ' ')}</TableCell>
                      <TableCell muted>{p.reference ?? '—'}</TableCell>
                      <TableCell align="right">{money(p.amount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableWrapper>
        </div>

        {invoice.notes && (
          <div className="rounded-lg border bg-card px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">Notes</p>
            <p className="mt-1 text-sm text-foreground">{invoice.notes}</p>
          </div>
        )}
      </div>

      <RecordPaymentDialog open={paymentOpen} onOpenChange={setPaymentOpen} invoiceId={invoice.id} outstanding={outstanding} />
      <RequestReturnDialog open={returnOpen} onOpenChange={setReturnOpen} invoice={invoice} />
    </>
  );
}
