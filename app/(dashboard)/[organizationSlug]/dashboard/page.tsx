/*
 * The home page.
 *
 * What a shop owner wants in the first three seconds: what sold today, what
 * is waiting on them, and what has just come in. Every figure is this
 * store's own — the page used to show a hard-coded set of purchase orders in
 * dollars.
 *
 * Sections follow permissions: someone with only `inventory.view` sees the
 * stock line and no money at all.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle, ArrowUpRight, Banknote, HelpCircle, PackageX, ShoppingBag, Undo2 } from 'lucide-react';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { StatCard, StatGrid } from '@/components/dashboard/stat-card';
import { EmptyState } from '@/components/layout/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from '@/components/ui/table';
import { formatMoney, formatNumber, formatRelativeTime } from '@/lib/format';
import {
  ORDER_CHANNEL_LABEL,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_VARIANT,
  ORDER_PAYMENT_LABEL,
  ORDER_PAYMENT_VARIANT,
} from '@/lib/sales/order-labels';
import { getDashboardOverview } from '@/features/dashboard/overview';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const overview = await getDashboardOverview();
  const { sales, inventory, currency } = overview;
  const now = new Date();

  /* Things that are actually waiting on someone, in the order a shop owner
   * would deal with them. Anything at zero simply isn't mentioned. */
  const attention = [
    sales?.openOrders
      ? {
          key: 'orders',
          icon: ShoppingBag,
          href: '/sales/orders',
          text:
            sales.openOrders === 1
              ? '1 order is waiting to be packed or confirmed'
              : `${formatNumber(sales.openOrders)} orders are waiting to be packed or confirmed`,
          action: 'Open orders',
        }
      : null,
    sales?.returnsAwaiting
      ? {
          key: 'returns',
          icon: Undo2,
          href: '/sales/returns',
          text:
            sales.returnsAwaiting === 1
              ? '1 customer is waiting on a return decision'
              : `${formatNumber(sales.returnsAwaiting)} customers are waiting on a return decision`,
          action: 'Review returns',
        }
      : null,
    sales?.unansweredQuestions
      ? {
          key: 'questions',
          icon: HelpCircle,
          href: '/sales/questions',
          text:
            sales.unansweredQuestions === 1
              ? '1 customer question has no answer yet'
              : `${formatNumber(sales.unansweredQuestions)} customer questions have no answer yet`,
          action: 'Answer them',
        }
      : null,
    inventory?.lowStockCount
      ? {
          key: 'stock',
          icon: PackageX,
          href: '/inventory/reports',
          text:
            inventory.lowStockCount === 1
              ? '1 product has run down to its reorder point'
              : `${formatNumber(inventory.lowStockCount)} products have run down to their reorder point`,
          action: 'See low stock',
        }
      : null,
    sales?.overdueInvoices
      ? {
          key: 'invoices',
          icon: AlertCircle,
          href: '/sales/invoices',
          text:
            sales.overdueInvoices === 1
              ? '1 invoice is past its due date'
              : `${formatNumber(sales.overdueInvoices)} invoices are past their due date`,
          action: 'Chase them',
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <>
      <PageHeader title="Dashboard" description={`What's happening at ${overview.organizationName} today.`} />

      <PageBody className="space-y-6">
        {attention.length > 0 && (
          <section aria-label="Needs attention" className="space-y-2">
            {attention.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="flex items-center gap-3 rounded-md border bg-card px-4 py-3 text-sm transition-colors hover:bg-muted/50"
              >
                <item.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 font-medium text-foreground">{item.text}</span>
                <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
                  {item.action}
                  <ArrowUpRight className="size-3" />
                </span>
              </Link>
            ))}
          </section>
        )}

        {(sales || inventory) && (
          <StatGrid>
            {sales && (
              <>
                <ClickableStat href="/sales/orders">
                  <StatCard
                    title="Paid today"
                    value={formatMoney(sales.revenueToday, currency)}
                    description="Money confirmed since midnight"
                    icon={Banknote}
                  />
                </ClickableStat>
                <ClickableStat href="/sales/orders">
                  <StatCard
                    title="Orders today"
                    value={formatNumber(sales.ordersToday)}
                    description={channelSplit(sales.todayByChannel)}
                    icon={ShoppingBag}
                  />
                </ClickableStat>
                <ClickableStat href="/sales/orders">
                  <StatCard
                    title="Waiting on you"
                    value={formatNumber(sales.openOrders)}
                    description="Not yet shipped"
                    icon={AlertCircle}
                  />
                </ClickableStat>
              </>
            )}
            {inventory && (
              <ClickableStat href="/inventory/reports">
                <StatCard
                  title="Low stock"
                  value={formatNumber(inventory.lowStockCount)}
                  description="At or below the reorder point"
                  icon={PackageX}
                />
              </ClickableStat>
            )}
          </StatGrid>
        )}

        {overview.canViewSales && (
          <section className="rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Latest orders</h2>
              <Link href="/sales/orders" className="text-xs font-medium text-primary hover:underline">
                View all
              </Link>
            </div>

            {overview.recentOrders.length === 0 ? (
              <EmptyState
                icon={ShoppingBag}
                title="No orders yet"
                description="When someone buys from your online store, their order shows up here."
              />
            ) : (
              <TableWrapper>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableColumnHeader>Order</TableColumnHeader>
                      <TableColumnHeader>Customer</TableColumnHeader>
                      <TableColumnHeader>Status</TableColumnHeader>
                      <TableColumnHeader>Payment</TableColumnHeader>
                      <TableColumnHeader className="text-right">Items</TableColumnHeader>
                      <TableColumnHeader className="text-right">Total</TableColumnHeader>
                      <TableColumnHeader className="text-right">Placed</TableColumnHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {overview.recentOrders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell>
                          <Link
                            href={`/sales/orders/${order.id}`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {order.reference}
                          </Link>
                        </TableCell>
                        <TableCell>{order.customerName || '—'}</TableCell>
                        <TableCell>
                          <Badge variant={ORDER_STATUS_VARIANT[order.status] ?? 'draft'}>
                            {ORDER_STATUS_LABEL[order.status] ?? '—'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={ORDER_PAYMENT_VARIANT[order.paymentStatus] ?? 'draft'}>
                            {ORDER_PAYMENT_LABEL[order.paymentStatus] ?? '—'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(order.itemCount)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(order.totalAmount, currency)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatRelativeTime(order.placedAt, now)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </section>
        )}

        {!sales && !inventory && (
          <EmptyState
            icon={AlertCircle}
            title="Nothing to show yet"
            description="Your role doesn't include sales or stock. Ask an admin if you think you should see more here."
          />
        )}
      </PageBody>
    </>
  );
}

/**
 * "8 online · 3 in store" — or just "Placed since midnight" when everything
 * came from one place, because naming a single channel adds nothing.
 */
function channelSplit(counts: { channel: string; count: number }[]): string {
  const named = counts.filter((c) => c.count > 0);
  if (named.length < 2) return 'Placed since midnight';
  return named
    .map((c) => `${formatNumber(c.count)} ${(ORDER_CHANNEL_LABEL[c.channel] ?? c.channel).toLowerCase()}`)
    .join(' · ');
}

/* Each stat leads to the list it counts (AGENTS §2). */
function ClickableStat({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded-lg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </Link>
  );
}
