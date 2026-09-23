'use client';

/*
 * The order list — online and in-store together.
 *
 * It used to hold the newest 200 orders and filter them in the browser,
 * which stopped being the whole truth at order 201. Search, filters and the
 * page number now live in the URL and become database queries (AGENTS §3),
 * so this component only ever holds the page it was given.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Plus, Search, ShoppingBag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { TablePagination } from '@/components/ui/table-pagination';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from '@/components/ui/table';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import {
  ORDER_STATUS_LABEL as STATUS_LABEL,
  ORDER_STATUS_VARIANT as STATUS_VARIANT,
  ORDER_PAYMENT_LABEL as PAYMENT_LABEL,
  ORDER_PAYMENT_VARIANT as PAYMENT_VARIANT,
  ORDER_CHANNEL_LABEL,
  ORDER_CHANNEL_VARIANT,
} from '@/lib/sales/order-labels';
import type { StoreOrderList } from '@/features/sales/orders';

const CHANNELS = ['ONLINE', 'WALK_IN', 'PHONE'] as const;
const STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;

export function OrdersPageClient({ list, canSell }: { list: StoreOrderList; canSell: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const channel = searchParams.get('channel') ?? 'all';
  const status = searchParams.get('status') ?? 'all';
  const urlQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = React.useState(urlQuery);

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '' || value === 'all') next.delete(key);
        else next.set(key, value);
      }
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  React.useEffect(() => {
    if (query === urlQuery) return;
    const timer = setTimeout(() => setParams({ q: query }), 350);
    return () => clearTimeout(timer);
  }, [query, urlQuery, setParams]);

  const filtered = channel !== 'all' || status !== 'all' || urlQuery !== '';
  const countFor = (key: string) => list.channelCounts.find((c) => c.channel === key)?.count ?? 0;

  const newSaleButton = canSell ? (
    <Button asChild size="sm">
      <Link href="/sales/orders/new">
        <Plus className="size-3.5" />
        New sale
      </Link>
    </Button>
  ) : undefined;

  const header = (
    <PageHeader
      title="Orders"
      description="Everything you've sold — online and over the counter."
      actions={newSaleButton}
    />
  );

  /* No orders at all is a different message from "your filters hid them". */
  if (list.historySize === 0) {
    return (
      <>
        {header}
        <PageBody>
          <EmptyState
            icon={ShoppingBag}
            title="No orders yet"
            description="Orders from your online store land here automatically. You can also ring up a sale at the counter."
            action={newSaleButton}
          />
        </PageBody>
      </>
    );
  }

  return (
    <>
      {header}

      <PageToolbar>
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search order number, name, email or phone"
            className="pl-8"
            aria-label="Search orders"
          />
        </div>

        <SelectRoot value={channel} onValueChange={(value) => setParams({ channel: value })}>
          <SelectTrigger className="w-40" aria-label="Filter by where the sale came from">
            <SelectValue placeholder="All channels" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            {CHANNELS.map((key) => (
              <SelectItem key={key} value={key}>
                {ORDER_CHANNEL_LABEL[key]} ({formatNumber(countFor(key))})
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>

        <SelectRoot value={status} onValueChange={(value) => setParams({ status: value })}>
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((key) => (
              <SelectItem key={key} value={key}>
                {STATUS_LABEL[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>

        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery('');
              setParams({ q: null, channel: null, status: null });
            }}
          >
            Clear filters
          </Button>
        )}
      </PageToolbar>

      <PageBody padded={false}>
        {list.rows.length === 0 ? (
          <EmptyState
            variant="filtered"
            icon={ShoppingBag}
            title="No orders match"
            description="Try a different search, or clear the filters."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setQuery('');
                  setParams({ q: null, channel: null, status: null });
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
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
                  {list.rows.map((order) => (
                    <TableRow
                      key={order.id}
                      onClick={() => router.push(`/sales/orders/${order.id}`)}
                      className="cursor-pointer"
                    >
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
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {order.city ? `${order.city}${order.state ? `, ${order.state}` : ''}` : '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="block text-foreground">{order.customerName ?? '—'}</span>
                        <span className="text-xs text-muted-foreground">{order.customerEmail ?? '—'}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(order.placedAt)}</TableCell>
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
                        {formatNumber(order.itemCount)}
                      </TableCell>
                      <TableCell align="right" className="font-medium tabular-nums">
                        {formatMoney(order.totalAmount, order.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>

            {list.pageCount > 1 && (
              <TablePagination
                page={list.page}
                totalPages={list.pageCount}
                totalItems={list.total}
                pageSize={list.perPage}
                onPageChange={(next) => setParams({ page: String(next) })}
              />
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
