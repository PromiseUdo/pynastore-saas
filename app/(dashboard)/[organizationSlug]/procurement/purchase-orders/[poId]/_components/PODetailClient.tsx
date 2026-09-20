'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
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
} from '@/components/ui/table';
import { ReceiveLineItemsDialog } from './ReceiveLineItemsDialog';
import { RejectPODialog } from './RejectPODialog';
import {
  submitForApproval,
  approvePurchaseOrder,
  markOrdered,
  markDropShipDelivered,
  cancelPurchaseOrder,
  type PODetail,
} from '@/features/procurement/actions';

type PODetailClientProps = {
  po: PODetail;
  can: {
    edit: boolean;
    approve: boolean;
    reject: boolean;
    receive: boolean;
  };
};

const STATUS_VARIANT: Record<PODetail['status'], 'draft' | 'pending' | 'approved' | 'rejected' | 'completed' | 'info' | 'muted'> = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ORDERED: 'info',
  PARTIALLY_RECEIVED: 'pending',
  RECEIVED: 'completed',
  CANCELLED: 'muted',
};

export function PODetailClient({ po, can }: PODetailClientProps) {
  const router = useRouter();
  const [isPending, setIsPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [receiveOpen, setReceiveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);

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
            <h1 className="text-lg font-semibold tracking-tight text-foreground">{po.poNumber}</h1>
            <Badge variant={STATUS_VARIANT[po.status]}>{po.status.replace('_', ' ')}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {po.customerId
              ? `${po.supplierName} → Ship to ${po.customerName} (drop-ship)`
              : `${po.supplierName} → ${po.warehouseName ?? 'No store set'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {po.status === 'DRAFT' && can.edit && (
            <Button size="sm" onClick={() => runAction(() => submitForApproval(po.id))} disabled={isPending}>
              Submit for approval
            </Button>
          )}
          {po.status === 'PENDING_APPROVAL' && can.approve && (
            <Button size="sm" onClick={() => runAction(() => approvePurchaseOrder(po.id))} disabled={isPending}>
              Approve
            </Button>
          )}
          {po.status === 'PENDING_APPROVAL' && can.reject && (
            <Button variant="outline" size="sm" onClick={() => setRejectOpen(true)} disabled={isPending}>
              Reject
            </Button>
          )}
          {po.status === 'APPROVED' && can.edit && (
            <Button size="sm" onClick={() => runAction(() => markOrdered(po.id))} disabled={isPending}>
              Mark ordered
            </Button>
          )}
          {po.status === 'ORDERED' && po.customerId && can.edit && (
            <Button size="sm" onClick={() => runAction(() => markDropShipDelivered(po.id))} disabled={isPending}>
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              Mark delivered to customer
            </Button>
          )}
          {(po.status === 'ORDERED' || po.status === 'PARTIALLY_RECEIVED') && !po.customerId && can.receive && (
            <Button size="sm" onClick={() => setReceiveOpen(true)} disabled={isPending}>
              Receive stock
            </Button>
          )}
          {['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(po.status) && can.edit && (
            <Button variant="outline" size="sm" onClick={() => runAction(() => cancelPurchaseOrder(po.id))} disabled={isPending}>
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4 px-6 py-6">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {po.rejectionReason && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Rejected: {po.rejectionReason}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Subtotal</CardTitle>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {po.currency} {po.subtotal.toFixed(2)}
              </p>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tax</CardTitle>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {po.currency} {po.taxAmount.toFixed(2)}
              </p>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Total</CardTitle>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {po.currency} {po.totalAmount.toFixed(2)}
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
                <TableColumnHeader align="right">{po.customerId ? 'Status' : 'Received'}</TableColumnHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {po.lineItems.map((li) => (
                <TableRow key={li.id}>
                  <TableCell>
                    <span className="font-medium text-foreground">{li.description}</span>
                    {!li.inventoryItemId && <p className="text-xs text-muted-foreground">Not linked to a catalog item</p>}
                  </TableCell>
                  <TableCell align="right">{li.quantity}</TableCell>
                  <TableCell align="right" muted>
                    {li.unitPrice.toFixed(2)}
                  </TableCell>
                  <TableCell align="right">{li.totalPrice.toFixed(2)}</TableCell>
                  <TableCell align="right" muted>
                    {po.customerId ? (po.status === 'RECEIVED' ? 'Delivered' : '—') : `${li.receivedQty} / ${li.quantity}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrapper>

        {po.notes && (
          <div className="rounded-lg border bg-card px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">Notes</p>
            <p className="mt-1 text-sm text-foreground">{po.notes}</p>
          </div>
        )}
      </div>

      <ReceiveLineItemsDialog open={receiveOpen} onOpenChange={setReceiveOpen} po={po} />
      <RejectPODialog open={rejectOpen} onOpenChange={setRejectOpen} poId={po.id} />
    </>
  );
}
