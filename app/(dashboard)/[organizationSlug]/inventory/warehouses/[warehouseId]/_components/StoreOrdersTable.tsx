'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { PageToolbar } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableWrapper, TableHead, TableBody, TableRow, TableColumnHeader, TableCell } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_VARIANT,
  ORDER_PAYMENT_LABEL,
  ORDER_PAYMENT_VARIANT,
  ORDER_CHANNEL_LABEL,
  ORDER_CHANNEL_VARIANT,
} from '@/lib/sales/order-labels';
import type { StoreOrderList } from '@/features/sales/orders';

const STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;

/**
 * The orders this store is on the hook for (ROADMAP Phase 8.4) — counter
 * sales rung up here and online orders its shelf supplied, **oldest first**,
 * because the oldest is the one the customer has been waiting on longest.
 *
 * The rows come from the same `listStoreOrders` the Sales list uses, so the
 * two can't disagree; only the filter and the order differ.
 */
export function StoreOrdersTable({ storeName, list }: { storeName: string; list: StoreOrderList }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, startTransition] = React.useTransition();

  const status = searchParams.get('status') ?? 'all';

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '' || value === 'all') next.delete(key);
        else next.set(key, value);
      }
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  if (list.total === 0 && status === 'all') {
    return (
      <div className="px-6 py-6">
        <EmptyState
          icon={ShoppingBag}
          title={`No orders have come off ${storeName} yet`}
          description="An order appears here when it is rung up at this store, or when an online order is filled from its shelf. Only stores that sell online supply the website."
          action={
            <Link href="/sales/orders" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              All orders
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <>
      <PageToolbar>
        <p className="text-xs text-muted-foreground">
          Oldest first — what {storeName} still owes a customer is at the top.
        </p>
        <div className="ml-auto flex items-center gap-2">
          <SelectRoot value={status} onValueChange={(value) => setParams({ status: value })}>
            <SelectTrigger className="w-40" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((key) => (
                <SelectItem key={key} value={key}>
                  {ORDER_STATUS_LABEL[key] ?? key}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
          <Link href="/sales/orders" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Open in Sales
          </Link>
        </div>
      </PageToolbar>

      <div className={cn('px-6 py-6 transition-opacity', isNavigating && 'opacity-60')}>
        {list.rows.length === 0 ? (
          <EmptyState
            variant="filtered"
            title="No orders here match that status"
            action={
              <Button variant="outline" size="sm" onClick={() => setParams({ status: null })}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Order</TableColumnHeader>
                  <TableColumnHeader>Customer</TableColumnHeader>
                  <TableColumnHeader>Placed</TableColumnHeader>
                  <TableColumnHeader>Status</TableColumnHeader>
                  <TableColumnHeader className="hidden sm:table-cell">Payment</TableColumnHeader>
                  <TableColumnHeader align="right">From here</TableColumnHeader>
                  <TableColumnHeader align="right">Order total</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {list.rows.map((order) => (
                  <TableRow key={order.id} clickable onClick={() => router.push(`/sales/orders/${order.id}`)}>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <Link
                          href={`/sales/orders/${order.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="font-medium tabular-nums text-foreground hover:underline"
                        >
                          {order.reference}
                        </Link>
                        <Badge variant={ORDER_CHANNEL_VARIANT[order.channel] ?? 'draft'}>
                          {ORDER_CHANNEL_LABEL[order.channel] ?? order.channel}
                        </Badge>
                      </span>
                      {order.fulfilledFrom.length > 1 && (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Also from {order.fulfilledFrom.filter((s) => s.name !== storeName).map((s) => s.name).join(', ')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="block text-foreground">{order.customerName ?? '—'}</span>
                      <span className="text-xs text-muted-foreground">{order.customerEmail ?? '—'}</span>
                    </TableCell>
                    <TableCell muted className="whitespace-nowrap">
                      {formatDate(order.placedAt)}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={ORDER_STATUS_VARIANT[order.status] ?? 'draft'}>
                          {ORDER_STATUS_LABEL[order.status] ?? order.status}
                        </Badge>
                        {order.returnsAwaiting > 0 && <Badge variant="warning">Return requested</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant={ORDER_PAYMENT_VARIANT[order.paymentStatus] ?? 'draft'}>
                        {ORDER_PAYMENT_LABEL[order.paymentStatus] ?? order.paymentStatus}
                      </Badge>
                    </TableCell>
                    <TableCell align="right" className="tabular-nums">
                      {order.unitsFromStore === null || order.unitsFromStore === 0
                        ? '—'
                        : `${formatNumber(order.unitsFromStore)} of ${formatNumber(order.itemCount)}`}
                    </TableCell>
                    <TableCell align="right" className="font-medium tabular-nums">
                      {formatMoney(order.totalAmount, order.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {list.pageCount > 1 ? (
              <TablePagination
                page={list.page}
                totalPages={list.pageCount}
                totalItems={list.total}
                pageSize={list.perPage}
                onPageChange={(page) => setParams({ page: page > 1 ? String(page) : null })}
              />
            ) : (
              <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                {formatNumber(list.total)} order{list.total === 1 ? '' : 's'} from this store
              </p>
            )}
          </TableWrapper>
        )}
      </div>
    </>
  );
}
