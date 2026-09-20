'use client';

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
import type { SupplierPerformance } from '@/features/procurement/actions';

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount);
}

export function SupplierPerformanceClient({ performance }: { performance: SupplierPerformance }) {
  return (
    <>
      <div className="border-b bg-background px-6 py-5">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{performance.supplierName}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Performance based on {performance.totalPOs} purchase order(s).</p>
      </div>

      <div className="space-y-6 px-6 py-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>On-time delivery</CardTitle>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {performance.onTimeRate === null ? '—' : `${Math.round(performance.onTimeRate * 100)}%`}
              </p>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Avg. lead time</CardTitle>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {performance.avgLeadTimeDays === null ? '—' : `${performance.avgLeadTimeDays.toFixed(1)}d`}
              </p>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Total spend</CardTitle>
              <p className="mt-1 text-2xl font-semibold text-foreground">{formatMoney(performance.totalSpend)}</p>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Received POs</CardTitle>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {performance.receivedPOs} / {performance.totalPOs}
              </p>
            </CardHeader>
          </Card>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Cost history</h2>
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Item</TableColumnHeader>
                  <TableColumnHeader>Date</TableColumnHeader>
                  <TableColumnHeader align="right">Unit price</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {performance.costHistory.length === 0 ? (
                  <TableEmpty colSpan={3} title="No priced line items yet" />
                ) : (
                  performance.costHistory.map((point, i) => (
                    <TableRow key={`${point.itemId}-${i}`}>
                      <TableCell className="font-medium text-foreground">{point.itemName}</TableCell>
                      <TableCell muted>{new Date(point.date).toLocaleDateString()}</TableCell>
                      <TableCell align="right">{point.unitPrice.toFixed(2)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableWrapper>
        </div>
      </div>
    </>
  );
}
