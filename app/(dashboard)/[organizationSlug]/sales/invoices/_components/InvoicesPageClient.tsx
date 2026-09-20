'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Receipt } from 'lucide-react';
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
import { CreateInvoiceDialog } from './CreateInvoiceDialog';
import type { InvoiceListRow, CustomerRow } from '@/features/sales/actions';
import type { ItemListRow, WarehouseRow } from '@/features/inventory/actions';

type InvoicesPageClientProps = {
  invoices: InvoiceListRow[];
  customers: CustomerRow[];
  warehouses: WarehouseRow[];
  items: ItemListRow[];
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

export function InvoicesPageClient({ invoices, customers, warehouses, items, canCreate }: InvoicesPageClientProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = React.useState(false);

  return (
    <>
      <div className="flex items-center justify-between border-b bg-background px-6 py-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Invoices</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Bill customers and track payments.</p>
        </div>
        {canCreate && (
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            disabled={customers.length === 0 || warehouses.length === 0}
          >
            <Plus className="size-3.5" />
            New invoice
          </Button>
        )}
      </div>

      <div className="px-6 py-6">
        {invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
            <Receipt className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No invoices yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {customers.length === 0 ? 'Add a customer first, then create an invoice.' : 'Create an invoice or convert an accepted quote.'}
            </p>
          </div>
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Invoice #</TableColumnHeader>
                  <TableColumnHeader>Customer</TableColumnHeader>
                  <TableColumnHeader>Status</TableColumnHeader>
                  <TableColumnHeader align="right">Total</TableColumnHeader>
                  <TableColumnHeader align="right">Paid</TableColumnHeader>
                  <TableColumnHeader>Due</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {invoices.length === 0 ? (
                  <TableEmpty colSpan={6} />
                ) : (
                  invoices.map((inv) => (
                    <TableRow key={inv.id} clickable onClick={() => router.push(`/sales/invoices/${inv.id}`)}>
                      <TableCell className="font-medium text-foreground">{inv.invoiceNumber}</TableCell>
                      <TableCell muted>{inv.customerName}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={STATUS_VARIANT[inv.status]}>{inv.status.replace('_', ' ')}</Badge>
                          {inv.isOverdue && <Badge variant="destructive">Overdue</Badge>}
                        </div>
                      </TableCell>
                      <TableCell align="right">
                        {inv.currency} {inv.totalAmount.toFixed(2)}
                      </TableCell>
                      <TableCell align="right" muted>
                        {inv.paidAmount.toFixed(2)}
                      </TableCell>
                      <TableCell muted>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      <CreateInvoiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        customers={customers}
        warehouses={warehouses}
        items={items}
      />
    </>
  );
}
