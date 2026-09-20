'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus, ArrowLeftRight, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
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
import { DispatchTransferDialog } from './DispatchTransferDialog';
import { receiveTransfer, cancelTransfer, type TransferRow } from '@/features/inventory/actions';
import type { ItemListRow, WarehouseRow } from '@/features/inventory/actions';

type TransfersPageClientProps = {
  transfers: TransferRow[];
  items: ItemListRow[];
  warehouses: WarehouseRow[];
  canManage: boolean;
};

const STATUS_VARIANT: Record<TransferRow['status'], 'pending' | 'completed' | 'muted'> = {
  DISPATCHED: 'pending',
  RECEIVED: 'completed',
  CANCELLED: 'muted',
};

const STATUS_LABEL: Record<TransferRow['status'], string> = {
  DISPATCHED: 'On the way',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

export function TransfersPageClient({ transfers, items, warehouses, canManage }: TransfersPageClientProps) {
  const router = useRouter();
  const [dispatchOpen, setDispatchOpen] = React.useState(false);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [cancelling, setCancelling] = React.useState<TransferRow | null>(null);

  async function handleReceive(transfer: TransferRow) {
    setPendingId(transfer.id);
    const result = await receiveTransfer(transfer.id);
    setPendingId(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`${transfer.itemName} received into ${transfer.toWarehouseName}`);
    router.refresh();
  }

  async function handleCancel() {
    if (!cancelling) return;
    setPendingId(cancelling.id);
    const result = await cancelTransfer(cancelling.id);
    setPendingId(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`Transfer cancelled — stock returned to ${cancelling.fromWarehouseName}`);
    setCancelling(null);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Stock sent from one store to another. It stays “on the way” until the receiving store confirms it arrived."
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setDispatchOpen(true)} disabled={warehouses.length < 2}>
              <Plus className="size-3.5" />
              Send stock
            </Button>
          ) : undefined
        }
      />

      {warehouses.length < 2 && (
        <PageToolbar>
          <p className="text-sm text-muted-foreground">
            Transfers need at least two stores.{' '}
            <Link href="/inventory/warehouses" className="font-medium text-primary hover:underline">
              Add another store
            </Link>
          </p>
        </PageToolbar>
      )}

      <PageBody>
        {transfers.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title="No transfers yet"
            description="Send stock between your stores and track it while it's on the way. For a move that's already done, record it on the Stock movements page instead."
            action={
              canManage && warehouses.length >= 2 ? (
                <Button size="sm" onClick={() => setDispatchOpen(true)}>
                  <Plus className="size-3.5" />
                  Send stock
                </Button>
              ) : undefined
            }
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Item</TableColumnHeader>
                  <TableColumnHeader>Route</TableColumnHeader>
                  <TableColumnHeader align="right">Quantity</TableColumnHeader>
                  <TableColumnHeader>Status</TableColumnHeader>
                  <TableColumnHeader>Sent</TableColumnHeader>
                  <TableColumnHeader>
                    <span className="sr-only">Actions</span>
                  </TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {transfers.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="py-2">
                        <span className="font-medium text-foreground">{t.itemName}</span>
                        <p className="font-mono text-xs text-muted-foreground">{t.sku}</p>
                      </TableCell>
                      <TableCell muted>
                        {t.fromWarehouseName} → {t.toWarehouseName}
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {formatNumber(t.quantity)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-0.5">
                          <Badge variant={STATUS_VARIANT[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                          {t.status === 'DISPATCHED' && (
                            <span className="text-[11px] text-muted-foreground">Waiting to be received</span>
                          )}
                          {t.status === 'RECEIVED' && t.receivedAt && (
                            <span className="text-[11px] text-muted-foreground">{formatDate(t.receivedAt)}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell muted className="whitespace-nowrap">
                        {formatDate(t.dispatchedAt)}
                      </TableCell>
                      <TableCell align="right">
                        {t.status === 'DISPATCHED' && canManage && (
                          <div className="flex justify-end gap-1">
                            <Button size="xs" onClick={() => handleReceive(t)} disabled={pendingId === t.id}>
                              {pendingId === t.id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                              Mark received
                            </Button>
                            <Button variant="outline" size="xs" onClick={() => setCancelling(t)} disabled={pendingId === t.id}>
                              <X className="size-3" />
                              Cancel
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </PageBody>

      <DispatchTransferDialog open={dispatchOpen} onOpenChange={setDispatchOpen} items={items} warehouses={warehouses} />

      <AlertDialogRoot open={cancelling !== null} onOpenChange={(open) => !open && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this transfer?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelling && (
                <>
                  {formatNumber(cancelling.quantity)} × {cancelling.itemName} goes back to{' '}
                  {cancelling.fromWarehouseName}, and {cancelling.toWarehouseName} won’t receive it. This can’t be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep transfer</AlertDialogCancel>
            <Button variant="destructive" onClick={handleCancel} disabled={pendingId !== null}>
              {pendingId !== null && <Loader2 className="size-3.5 animate-spin" />}
              Cancel transfer
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </>
  );
}
