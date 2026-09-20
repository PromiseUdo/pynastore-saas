'use client';

/*
 * The online-store orders list.
 *
 * Search and a status filter live in component state rather than the URL for
 * now because this list is capped at the most recent 200 orders and has no
 * pagination yet; when it grows past that, both move into `searchParams`
 * along with the page, the way inventory/products does it.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search, ShoppingBag } from 'lucide-react';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from '@/components/ui/table';
import { formatDate, formatMoney } from '@/lib/format';
import type { StoreOrderRow } from '@/features/sales/orders';
import {
  ORDER_PAYMENT_LABEL as PAYMENT_LABEL,
  ORDER_PAYMENT_VARIANT as PAYMENT_VARIANT,
  ORDER_STATUS_LABEL as STATUS_LABEL,
  ORDER_STATUS_VARIANT as STATUS_VARIANT,
} from '@/lib/sales/order-labels';

const FILTERS = [
  'All',
  'Awaiting transfer',
  'Returns and refunds',
  'New',
  'Confirmed',
  'Being packed',
  'Shipped',
  'Delivered',
  'Cancelled',
] as const;

export function OrdersPageClient({ orders }: { orders: StoreOrderRow[] }) {
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>('All');

  const rows = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesFilter =
        filter === 'All' ||
        (filter === 'Awaiting transfer'
          ? order.paymentStatus === 'AWAITING_TRANSFER' && order.status === 'PENDING'
          : filter === 'Returns and refunds'
            ? order.returnsAwaiting > 0 || order.refundOwed
            : STATUS_LABEL[order.status] === filter);
      const matchesQuery =
        !needle ||
        order.reference.toLowerCase().includes(needle) ||
        order.customerName.toLowerCase().includes(needle) ||
        order.customerEmail.toLowerCase().includes(needle);
      return matchesFilter && matchesQuery;
    });
  }, [orders, query, filter]);

  if (orders.length === 0) {
    return (
      <>
        <PageHeader
          title="Online orders"
          description="Everything customers have bought on your online store."
        />
        <PageBody>
          <EmptyState
            icon={ShoppingBag}
            title="No online orders yet"
            description="When someone checks out on your store, their order appears here with the delivery address and what they paid."
          />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Online orders"
        description="Everything customers have bought on your online store."
      />

      <PageToolbar>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search order number, name or email"
            className="pl-8"
            aria-label="Search orders"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              aria-pressed={filter === option}
              className={
                filter === option
                  ? 'h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground'
                  : 'h-8 rounded-md border px-3 text-xs font-medium text-muted-foreground hover:text-foreground'
              }
            >
              {option}
            </button>
          ))}
        </div>
      </PageToolbar>

      <PageBody>
        {rows.length === 0 ? (
          <EmptyState
            variant="filtered"
            icon={ShoppingBag}
            title="No orders match"
            description="Try a different search or clear the filter."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery('');
                  setFilter('All');
                }}
              >
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
                  <TableColumnHeader>Payment</TableColumnHeader>
                  <TableColumnHeader align="right">Items</TableColumnHeader>
                  <TableColumnHeader align="right">Total</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((order) => (
                  <TableRow
                    key={order.id}
                    onClick={() => router.push(`/sales/orders/${order.id}`)}
                    className="cursor-pointer"
                  >
                    <TableCell>
                      <a
                        href={`/sales/orders/${order.id}`}
                        onClick={(event) => event.stopPropagation()}
                        className="font-medium tabular-nums text-foreground hover:underline"
                      >
                        {order.reference}
                      </a>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {order.city || '—'}
                        {order.state ? `, ${order.state}` : ''}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="block text-foreground">{order.customerName || '—'}</span>
                      <span className="text-xs text-muted-foreground">{order.customerEmail}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(order.placedAt)}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={STATUS_VARIANT[order.status] ?? 'draft'}>
                          {STATUS_LABEL[order.status] ?? '—'}
                        </Badge>
                        {order.returnsAwaiting > 0 && <Badge variant="warning">Return requested</Badge>}
                        {order.refundOwed && <Badge variant="warning">Refund owed</Badge>}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={PAYMENT_VARIANT[order.paymentStatus] ?? 'draft'}>
                        {PAYMENT_LABEL[order.paymentStatus] ?? order.paymentStatus}
                      </Badge>
                    </TableCell>
                    <TableCell align="right" className="tabular-nums">
                      {order.itemCount}
                    </TableCell>
                    <TableCell align="right" className="font-medium tabular-nums">
                      {formatMoney(order.totalAmount, order.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </PageBody>
    </>
  );
}
