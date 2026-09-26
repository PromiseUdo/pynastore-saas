/*
 * Sales → Orders → one order.
 *
 * Everything the merchant needs to pack and send it: who it's for, where it
 * goes, what's in it, and whether the money has arrived. The delivery
 * address is the one the shopper gave at checkout — a snapshot on the order
 * itself, so editing an address book afterwards never rewrites a parcel
 * label that has already been printed.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Printer } from 'lucide-react';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { PageHeader, PageBody } from '@/components/layout/page-header';
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
import { formatDate, formatMoney } from '@/lib/format';
import { getStoreOrder } from '@/features/sales/orders';
import {
  ORDER_CHANNEL_LABEL,
  ORDER_CHANNEL_VARIANT,
  ORDER_PAYMENT_LABEL,
  ORDER_PAYMENT_VARIANT,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_VARIANT,
  PAYMENT_METHOD_LABEL,
  nextStepHint,
} from '@/lib/sales/order-labels';
import { UNPAID_ORDER_HOLD_MINUTES } from '@/lib/storefront/orders/lifecycle';
import { TRANSFER_HOLD_HOURS } from '@/lib/storefront/mock/checkout';
import { OrderActions } from './_components/OrderActions';
import { OrderReturnsPanel } from './_components/OrderReturnsPanel';
import { RecordOrderRefundButton } from './_components/RefundDialog';

export default async function StoreOrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="online store orders" />;
  }

  const { orderId } = await params;
  const result = await getStoreOrder(orderId);

  /* "Not found" and "the load failed" are different things, and only one of
   * them is the merchant's to fix. A genuine miss is a 404; anything else
   * goes to the boundary, which offers a retry. */
  if (!result.success) {
    if (result.error === 'Order not found') notFound();
    throw new Error(result.error);
  }

  const order = result.data;
  const canManage = hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_FULFILLMENT_MANAGE);
  const canManageReturns = hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_RETURN_MANAGE);
  const refundOwed = order.status === 'CANCELLED' && order.refundable > 0;
  /* A counter sale never went through confirming, packing and shipping — it
   * happened all at once — so the online progress track would be a row of
   * ticks for steps nobody took. */
  const isCounterSale = order.channel !== 'ONLINE';
  /* Which store's shelf this came off. One store is a fact for the summary
     card; several means the parcel is packed in more than one place, so each
     line has to say where its units are (ROADMAP Phase 8.4). */
  const splitAcrossStores = order.fulfilledFrom.length > 1;
  const STAGES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] as const;
  const reached = order.status === 'CANCELLED' ? -1 : STAGES.indexOf(order.status as (typeof STAGES)[number]);
  const stageAt = [order.placedAt, order.confirmedAt, order.packingAt, order.shippedAt, order.deliveredAt];
  const progress = STAGES.map((stage, index) => ({
    label: stage === 'PENDING' ? 'Placed' : ORDER_STATUS_LABEL[stage],
    at: stageAt[index] ?? (index === 0 ? order.placedAt : null),
    // A cancelled order shows the stages it did reach, by their dates.
    done: reached >= 0 ? index <= reached : Boolean(stageAt[index]),
  }));

  const hint = nextStepHint({
    status: order.status,
    paymentStatus: order.paymentStatus,
    channel: order.channel,
    cancelReason: order.cancelReason,
    holdMinutes: UNPAID_ORDER_HOLD_MINUTES,
    transferHoldHours: TRANSFER_HOLD_HOURS,
    returnsAwaiting: order.returns.filter((r) => r.status === 'REQUESTED').length,
  });

  return (
    <>
      <PageHeader
        title={order.reference}
        description={`Placed ${formatDate(order.placedAt)} · ${order.itemCount} ${
          order.itemCount === 1 ? 'item' : 'items'
        } · ${formatMoney(order.totalAmount, order.currency)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/sales/orders"
              className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" />
              All orders
            </Link>
            <Link
              href={`/sales/orders/${order.id}/receipt`}
              className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <Printer className="size-3.5" />
              Receipt
            </Link>
            {canManageReturns && refundOwed && (
              <RecordOrderRefundButton
                orderId={order.id}
                refundable={order.refundable}
                currency={order.currency}
                paymentMethod={order.paymentMethod}
              />
            )}
            {canManage && (
              <OrderActions
                orderId={order.id}
                status={order.status}
                paymentStatus={order.paymentStatus}
                channel={order.channel}
                cancelReason={order.cancelReason}
                reference={order.reference}
                totalAmount={order.totalAmount}
                currency={order.currency}
              />
            )}
          </div>
        }
      />

      <PageBody>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={ORDER_STATUS_VARIANT[order.status] ?? 'draft'}>
            {ORDER_STATUS_LABEL[order.status] ?? order.status}
          </Badge>
          <Badge variant={ORDER_PAYMENT_VARIANT[order.paymentStatus] ?? 'draft'}>
            {ORDER_PAYMENT_LABEL[order.paymentStatus] ?? order.paymentStatus}
          </Badge>
          <Badge variant={ORDER_CHANNEL_VARIANT[order.channel] ?? 'draft'}>
            {ORDER_CHANNEL_LABEL[order.channel] ?? order.channel}
          </Badge>
          {order.isGuest && !isCounterSale && <Badge variant="draft">Guest checkout</Badge>}
        </div>
        {hint && <p className="mt-2 text-sm text-muted-foreground">{hint}</p>}

        {!isCounterSale && (
        <section className="mt-4 rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold">Progress</h2>
          <ol className="mt-3 grid gap-3 text-sm sm:grid-cols-5">
            {progress.map((stage) => (
              <li key={stage.label} className="flex items-start gap-2 sm:flex-col sm:gap-1">
                <span
                  aria-hidden
                  className={`mt-1.5 size-2 shrink-0 rounded-full sm:mt-0 ${stage.done ? 'bg-primary' : 'bg-border'}`}
                />
                <div>
                  <p className={stage.done ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                    {stage.label}
                    <span className="sr-only">{stage.done ? ' — done' : ' — not yet'}</span>
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {stage.at ? formatDate(stage.at) : stage.done ? 'Skipped' : '—'}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          {order.status === 'CANCELLED' && (
            <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
              {order.cancelReason === 'customer' ? 'Cancelled by the customer' : 'Cancelled'}{' '}
              {formatDate(order.cancelledAt)}.
              {order.cancelNote && (
                <span className="mt-1 block text-sm text-foreground">
                  <span className="text-muted-foreground">They said: </span>“{order.cancelNote}”
                </span>
              )}
            </p>
          )}
        </section>
        )}

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Customer</h2>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Name</dt>
                <dd>{order.customerName || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Email</dt>
                <dd className="break-all">{order.customerEmail ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Phone</dt>
                <dd>{order.phone || '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border bg-card p-4">
            {/* A counter sale was carried out of the shop; there is no address
              * to show, so the card says where it was sold instead of leaving
              * an empty one that looks like missing data. */}
            {isCounterSale ? (
              <>
                <h2 className="text-sm font-semibold">Sold in</h2>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Store</dt>
                    <dd>{order.storeName ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Served by</dt>
                    <dd>{order.soldByName ?? '—'}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <>
                <h2 className="text-sm font-semibold">Deliver to</h2>
                <address className="mt-3 space-y-0.5 text-sm not-italic">
                  <span className="block">{order.shipFullName ?? '—'}</span>
                  <span className="block text-muted-foreground">{order.shipLine1 ?? '—'}</span>
                  {order.shipLine2 && <span className="block text-muted-foreground">{order.shipLine2}</span>}
                  <span className="block text-muted-foreground">
                    {[order.city, order.state].filter(Boolean).join(', ')}
                  </span>
                  <span className="block text-muted-foreground">
                    {[order.shipCountry, order.shipPostalCode].filter(Boolean).join(' ')}
                  </span>
                  <span className="block text-muted-foreground">{order.shipPhone ?? '—'}</span>
                </address>
              </>
            )}
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">{isCounterSale ? 'Payment' : 'Delivery and payment'}</h2>
            {!isCounterSale && (
              <>
                <p className="mt-3 text-sm">{order.deliveryMethodLabel ?? '—'}</p>
                <p className="text-sm text-muted-foreground">{formatMoney(order.deliveryFee, order.currency)}</p>
              </>
            )}
            <dl className="mt-3 space-y-1.5 border-t pt-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Payment</dt>
                <dd>
                  {PAYMENT_METHOD_LABEL[order.paymentMethod] ?? '—'}
                  {order.paidAt ? ` · paid ${formatDate(order.paidAt)}` : ''}
                </dd>
              </div>
              {!isCounterSale && (
                <div>
                  <dt className="text-xs text-muted-foreground">Fulfilled from</dt>
                  <dd>
                    {order.fulfilledFrom.length === 0 ? (
                      <span className="text-muted-foreground">
                        {order.stockReleased ? 'Stock was released back to your stores' : 'No stock held yet'}
                      </span>
                    ) : (
                      <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                        {order.fulfilledFrom.map((store) => (
                          <Link
                            key={store.warehouseId}
                            href={`/inventory/warehouses/${store.warehouseId}`}
                            className="hover:underline"
                          >
                            {store.name}
                            {splitAcrossStores && (
                              <span className="text-muted-foreground tabular-nums"> · {store.units}</span>
                            )}
                          </Link>
                        ))}
                      </span>
                    )}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted-foreground">Stock</dt>
                <dd className="tabular-nums">
                  {order.stock.held > 0
                    ? `${order.stock.held} held in your stores`
                    : order.stock.dispatched > 0
                      ? `${order.stock.dispatched} sent`
                      : '—'}
                </dd>
              </div>
              {order.transferDetails && (
                <div>
                  <dt className="text-xs text-muted-foreground">Customer was asked to pay into</dt>
                  {order.transferDetails.map((account) => (
                    <dd key={account.accountNumber} className="tabular-nums">
                      {account.bankName} · {account.accountNumber}
                    </dd>
                  ))}
                </div>
              )}
            </dl>
            {order.note && (
              <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Customer note: </span>
                {order.note}
              </p>
            )}
          </section>
        </div>

        <div className="mt-4 rounded-lg border bg-card">
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Items</h2>
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Product</TableColumnHeader>
                  {splitAcrossStores && <TableColumnHeader>From</TableColumnHeader>}
                  <TableColumnHeader align="right">Qty</TableColumnHeader>
                  <TableColumnHeader align="right">Unit price</TableColumnHeader>
                  <TableColumnHeader align="right">Total</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {order.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <span className="block text-foreground">{line.name}</span>
                      {line.variantName && (
                        <span className="text-xs text-muted-foreground">{line.variantName}</span>
                      )}
                    </TableCell>
                    {splitAcrossStores && (
                      <TableCell muted>
                        {line.fromStores.length === 0
                          ? '—'
                          : line.fromStores
                              .map((store) => (store.units === line.quantity ? store.name : `${store.name} × ${store.units}`))
                              .join(', ')}
                      </TableCell>
                    )}
                    <TableCell align="right" className="tabular-nums">
                      {line.quantity}
                    </TableCell>
                    <TableCell align="right" className="tabular-nums">
                      {formatMoney(line.unitPrice, order.currency)}
                    </TableCell>
                    <TableCell align="right" className="font-medium tabular-nums">
                      {formatMoney(line.totalPrice, order.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>

          <dl className="space-y-1.5 border-t px-4 py-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular-nums">{formatMoney(order.subtotal, order.currency)}</dd>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">
                  Discount
                  {order.discountCode && (
                    <span className="ml-1.5 font-mono text-xs uppercase text-foreground">{order.discountCode}</span>
                  )}
                </dt>
                <dd className="tabular-nums">−{formatMoney(order.discount, order.currency)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Delivery</dt>
              <dd className="tabular-nums">{formatMoney(order.deliveryFee, order.currency)}</dd>
            </div>
            <div className="flex justify-between border-t pt-1.5 font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatMoney(order.totalAmount, order.currency)}</dd>
            </div>
            {/* VAT is included in the listed prices, not added on top — stated
             * here so the column adds up and the figure is still to hand. */}
            {order.taxAmount > 0 && (
              <p className="text-xs text-muted-foreground">
                Includes {formatMoney(order.taxAmount, order.currency)} VAT
              </p>
            )}
          </dl>
        </div>

        <OrderReturnsPanel order={order} canManage={canManageReturns} />
      </PageBody>
    </>
  );
}
