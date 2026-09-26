'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, ClipboardList } from 'lucide-react';
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
import { CreatePurchaseOrderDialog } from './CreatePurchaseOrderDialog';
import type { POListRow, SupplierRow } from '@/features/procurement/actions';
import type { ItemListRow, WarehouseRow } from '@/features/inventory/actions';
import { enumLabel, formatDate, formatMoney } from '@/lib/format';

type PurchaseOrdersPageClientProps = {
  purchaseOrders: POListRow[];
  suppliers: SupplierRow[];
  warehouses: WarehouseRow[];
  items: ItemListRow[];
  canCreate: boolean;
  organizationSlug: string;
};

const STATUS_VARIANT: Record<POListRow['status'], 'draft' | 'pending' | 'approved' | 'rejected' | 'completed' | 'info' | 'muted'> = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ORDERED: 'info',
  PARTIALLY_RECEIVED: 'pending',
  RECEIVED: 'completed',
  CANCELLED: 'muted',
};

export function PurchaseOrdersPageClient({
  purchaseOrders,
  suppliers,
  warehouses,
  items,
  canCreate,
  organizationSlug,
}: PurchaseOrdersPageClientProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = React.useState(false);

  return (
    <>
      <div className="flex items-center justify-between border-b bg-background px-6 py-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Purchase orders</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Track restocks from draft through receiving.</p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={suppliers.length === 0 || warehouses.length === 0}>
            <Plus className="size-3.5" />
            New purchase order
          </Button>
        )}
      </div>

      <div className="px-6 py-6">
        {purchaseOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
            <ClipboardList className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No purchase orders yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {suppliers.length === 0
                ? 'Add a supplier first, then create your first purchase order.'
                : 'Create a purchase order to restock your suppliers.'}
            </p>
          </div>
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>PO #</TableColumnHeader>
                  <TableColumnHeader>Supplier</TableColumnHeader>
                  <TableColumnHeader>Store</TableColumnHeader>
                  <TableColumnHeader>Status</TableColumnHeader>
                  <TableColumnHeader align="right">Total</TableColumnHeader>
                  <TableColumnHeader>Created</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {purchaseOrders.length === 0 ? (
                  <TableEmpty colSpan={6} />
                ) : (
                  purchaseOrders.map((po) => (
                    <TableRow
                      key={po.id}
                      clickable
                      onClick={() => router.push(`/procurement/purchase-orders/${po.id}`)}
                    >
                      <TableCell className="font-medium text-foreground">{po.poNumber}</TableCell>
                      <TableCell muted>{po.supplierName}</TableCell>
                      <TableCell muted>{po.warehouseName ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[po.status]}>{enumLabel(po.status)}</Badge>
                      </TableCell>
                      <TableCell align="right">
                        {formatMoney(po.totalAmount, po.currency)}
                      </TableCell>
                      <TableCell muted>{formatDate(po.createdAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      <CreatePurchaseOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        suppliers={suppliers}
        warehouses={warehouses}
        items={items}
      />
    </>
  );
}
