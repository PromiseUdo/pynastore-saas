'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from '@/components/ui/table';
import { recordPicked, recordPacked, markShipped, cancelFulfillment, type FulfillmentDetail } from '@/features/sales/actions';
import { enumLabel, formatDate } from '@/lib/format';

type FulfillmentDetailClientProps = {
  fulfillment: FulfillmentDetail;
  canManage: boolean;
};

const STATUS_VARIANT: Record<FulfillmentDetail['status'], 'draft' | 'pending' | 'approved' | 'completed' | 'muted'> = {
  PENDING: 'draft',
  PARTIALLY_PICKED: 'pending',
  PICKED: 'pending',
  PARTIALLY_PACKED: 'approved',
  PACKED: 'approved',
  SHIPPED: 'completed',
  CANCELLED: 'muted',
};

export function FulfillmentDetailClient({ fulfillment, canManage }: FulfillmentDetailClientProps) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);
  const [pickInputs, setPickInputs] = React.useState<Record<string, string>>(
    Object.fromEntries(fulfillment.lineItems.map((li) => [li.id, String(li.pickedQty)])),
  );
  const [packInputs, setPackInputs] = React.useState<Record<string, string>>(
    Object.fromEntries(fulfillment.lineItems.map((li) => [li.id, String(li.packedQty)])),
  );
  const [carrier, setCarrier] = React.useState('');
  const [trackingNumber, setTrackingNumber] = React.useState('');

  const isPicking = fulfillment.status === 'PENDING' || fulfillment.status === 'PARTIALLY_PICKED';
  const isPacking = fulfillment.status === 'PICKED' || fulfillment.status === 'PARTIALLY_PACKED';
  const canCancel = fulfillment.status === 'PENDING' || fulfillment.status === 'PARTIALLY_PICKED' || fulfillment.status === 'PICKED';

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

  async function handleRecordPicked() {
    await runAction(() =>
      recordPicked(
        fulfillment.id,
        { lines: fulfillment.lineItems.map((li) => ({ fulfillmentLineItemId: li.id, quantity: Number(pickInputs[li.id] ?? 0) })) },
      ),
    );
  }

  async function handleRecordPacked() {
    await runAction(() =>
      recordPacked(
        fulfillment.id,
        { lines: fulfillment.lineItems.map((li) => ({ fulfillmentLineItemId: li.id, quantity: Number(packInputs[li.id] ?? 0) })) },
      ),
    );
  }

  async function handleShip() {
    await runAction(() =>
      markShipped(fulfillment.id, { carrier: carrier.trim() || undefined, trackingNumber: trackingNumber.trim() || undefined }),
    );
  }

  return (
    <>
      <div className="flex items-center justify-between border-b bg-background px-6 py-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">Fulfillment for {fulfillment.invoiceNumber}</h1>
            <Badge variant={STATUS_VARIANT[fulfillment.status]}>{enumLabel(fulfillment.status)}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {fulfillment.customerName} · {fulfillment.warehouseName} ·{' '}
            <Link href={`/sales/invoices/${fulfillment.invoiceId}`} className="text-primary hover:underline">
              View invoice
            </Link>
          </p>
        </div>
        {canCancel && canManage && (
          <Button variant="outline" size="sm" onClick={() => runAction(() => cancelFulfillment(fulfillment.id))} disabled={isPending}>
            Cancel fulfillment
          </Button>
        )}
      </div>

      <div className="space-y-4 px-6 py-6">
        {error && <p className="text-sm text-destructive">{error}</p>}

        <TableWrapper>
          <Table>
            <TableHead>
              <TableRow>
                <TableColumnHeader>Item</TableColumnHeader>
                <TableColumnHeader align="right">Ordered</TableColumnHeader>
                <TableColumnHeader align="right">{isPicking ? 'Picked (enter)' : 'Picked'}</TableColumnHeader>
                <TableColumnHeader align="right">{isPacking ? 'Packed (enter)' : 'Packed'}</TableColumnHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {fulfillment.lineItems.map((li) => (
                <TableRow key={li.id}>
                  <TableCell>
                    <span className="font-medium text-foreground">{li.itemName}</span>
                    <p className="text-xs text-muted-foreground">{li.location ?? 'No location set'}</p>
                  </TableCell>
                  <TableCell align="right">{li.quantity}</TableCell>
                  <TableCell align="right">
                    {isPicking && canManage ? (
                      <Input
                        className="ml-auto h-7 w-20 text-right"
                        type="number"
                        min="0"
                        max={li.quantity}
                        value={pickInputs[li.id] ?? ''}
                        onChange={(e) => setPickInputs((prev) => ({ ...prev, [li.id]: e.target.value }))}
                      />
                    ) : (
                      li.pickedQty
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {isPacking && canManage ? (
                      <Input
                        className="ml-auto h-7 w-20 text-right"
                        type="number"
                        min="0"
                        max={li.pickedQty}
                        value={packInputs[li.id] ?? ''}
                        onChange={(e) => setPackInputs((prev) => ({ ...prev, [li.id]: e.target.value }))}
                      />
                    ) : (
                      li.packedQty
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrapper>

        {isPicking && canManage && (
          <Button size="sm" onClick={handleRecordPicked} disabled={isPending}>
            {isPending && <Loader2 className="size-3.5 animate-spin" />}
            Save picked quantities
          </Button>
        )}

        {isPacking && canManage && (
          <Button size="sm" onClick={handleRecordPacked} disabled={isPending}>
            {isPending && <Loader2 className="size-3.5 animate-spin" />}
            Save packed quantities
          </Button>
        )}

        {fulfillment.status === 'PACKED' && canManage && (
          <div className="max-w-sm space-y-3 rounded-lg border bg-card p-4">
            <p className="text-sm font-medium text-foreground">Ready to ship</p>
            <div className="space-y-1.5">
              <Label htmlFor="carrier">Carrier</Label>
              <Input id="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tracking">Tracking number</Label>
              <Input id="tracking" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} />
            </div>
            <Button size="sm" onClick={handleShip} disabled={isPending}>
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              Mark shipped
            </Button>
          </div>
        )}

        {fulfillment.status === 'SHIPPED' && (
          <div className="max-w-sm rounded-lg border bg-card p-4 text-sm">
            <p className="font-medium text-foreground">Shipped</p>
            <p className="mt-1 text-muted-foreground">
              {fulfillment.carrier ?? 'Carrier not set'}
              {fulfillment.trackingNumber ? ` · ${fulfillment.trackingNumber}` : ''}
            </p>
            {fulfillment.shippedAt && (
              <p className="mt-1 text-xs text-muted-foreground">{formatDate(fulfillment.shippedAt)}</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
