'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { PackageSearch } from 'lucide-react';
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
import type { FulfillmentListRow } from '@/features/sales/actions';
import { enumLabel, formatDate } from '@/lib/format';

type FulfillmentPageClientProps = {
  fulfillments: FulfillmentListRow[];
};

const STATUS_VARIANT: Record<FulfillmentListRow['status'], 'draft' | 'pending' | 'approved' | 'completed' | 'muted'> = {
  PENDING: 'draft',
  PARTIALLY_PICKED: 'pending',
  PICKED: 'pending',
  PARTIALLY_PACKED: 'approved',
  PACKED: 'approved',
  SHIPPED: 'completed',
  CANCELLED: 'muted',
};

export function FulfillmentPageClient({ fulfillments }: FulfillmentPageClientProps) {
  const router = useRouter();

  return (
    <>
      <div className="border-b bg-background px-6 py-5">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Fulfillment</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Pick, pack, and ship issued orders.</p>
      </div>

      <div className="px-6 py-6">
        {fulfillments.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
            <PackageSearch className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Nothing to fulfill</p>
            <p className="max-w-sm text-xs text-muted-foreground">Issuing an invoice with stock-linked items creates a fulfillment here.</p>
          </div>
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Invoice</TableColumnHeader>
                  <TableColumnHeader>Customer</TableColumnHeader>
                  <TableColumnHeader>Store</TableColumnHeader>
                  <TableColumnHeader>Status</TableColumnHeader>
                  <TableColumnHeader align="right">Items</TableColumnHeader>
                  <TableColumnHeader>Created</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {fulfillments.length === 0 ? (
                  <TableEmpty colSpan={6} />
                ) : (
                  fulfillments.map((f) => (
                    <TableRow key={f.id} clickable onClick={() => router.push(`/sales/fulfillment/${f.id}`)}>
                      <TableCell className="font-medium text-foreground">{f.invoiceNumber}</TableCell>
                      <TableCell muted>{f.customerName}</TableCell>
                      <TableCell muted>{f.warehouseName}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[f.status]}>{enumLabel(f.status)}</Badge>
                      </TableCell>
                      <TableCell align="right">{f.itemCount}</TableCell>
                      <TableCell muted>{formatDate(f.createdAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </div>
    </>
  );
}
