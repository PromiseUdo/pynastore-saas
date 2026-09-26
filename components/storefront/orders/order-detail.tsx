/*
 * One order, in full.
 *
 * Shared by the account's order page and the guest tracker, because both are
 * showing the same record to the same person — one of them just happens to
 * have signed in. The differences are `showReorder` (buying again needs a
 * bag, and a guest tracking an order on a friend's phone shouldn't have
 * items quietly added to it) and `selfService`: only the account can cancel
 * or ask for a return; a guest is told how to sign in to do it.
 *
 * Everything reads from the ORDER: names, prices, the address, the delivery
 * promise. Nothing is re-derived from the catalogue, so an order still reads
 * correctly years later.
 */
import { formatEtaWindow } from '@/lib/storefront/delivery/eta';
import type * as React from 'react';
import { formatDate, formatMoney } from '@/lib/storefront/format';
import { cancelledRefundSentence, paymentHint } from '@/lib/storefront/orders/labels';
import type { StorefrontOrder } from '@/lib/storefront/orders/types';
import { OrderLines, orderAddressLines } from '@/components/storefront/checkout/order-lines';
import { OrderStatusPill, PaymentStatusPill } from './order-status';
import { OrderTimeline } from './order-timeline';
import { ReorderButton } from './reorder-button';
import { OrderSelfService } from './order-self-service';
import { OrderReturns } from './order-returns';
import { TransferInstructions } from './transfer-instructions';

export function OrderDetail({
  order,
  locale,
  showReorder = false,
  selfService = 'guest',
  paymentAction,
}: {
  order: StorefrontOrder;
  locale: string;
  showReorder?: boolean;
  /** 'account' offers cancel/return buttons; 'guest' explains how to get them */
  selfService?: 'account' | 'guest';
  /** e.g. "Pay now", when the order can still be paid online */
  paymentAction?: React.ReactNode;
}) {
  const { totals } = order;

  return (
    <div className="space-y-5">
      <header className="rounded-3xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-semibold tabular-nums sm:text-2xl">
              {order.reference}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Placed {formatDate(order.placedAt, locale)} · {order.itemCount}{' '}
              {order.itemCount === 1 ? 'item' : 'items'} ·{' '}
              {formatMoney(totals.total, order.currency)}
            </p>
          </div>
          <OrderStatusPill status={order.status} />
        </div>

        {/* A cancelled order that was never paid has nothing left to pay —
          * "Awaiting payment" beside "Cancelled" would say otherwise. One that
          * was paid says what the store owes and what it has sent back. */}
        {order.status !== 'CANCELLED' ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <PaymentStatusPill status={order.paymentStatus} />
            <p className="text-sm text-muted-foreground">{paymentHint(order.paymentStatus)}</p>
          </div>
        ) : (
          (order.refunds.owed > 0 || order.refunds.total > 0) && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <PaymentStatusPill status={order.paymentStatus} />
              <p className="text-sm text-muted-foreground">{cancelledRefundSentence(order, locale)}</p>
            </div>
          )
        )}

        {paymentAction && <div className="mt-4">{paymentAction}</div>}

        <div className="mt-4 empty:hidden">
          <OrderSelfService order={order} mode={selfService} locale={locale} />
        </div>

        {showReorder && (
          <div className="mt-5">
            <ReorderButton order={order} />
          </div>
        )}
      </header>

      {order.paymentStatus === 'AWAITING_TRANSFER' && order.status !== 'CANCELLED' && order.transferDetails && (
        <TransferInstructions
          accounts={order.transferDetails}
          total={totals.total}
          currency={order.currency}
          reference={order.reference}
        />
      )}

      <section
        aria-labelledby="order-progress"
        className="rounded-3xl border border-border bg-card p-5 sm:p-6"
      >
        <h2 id="order-progress" className="text-sm font-semibold">
          Progress
        </h2>
        <div className="mt-4">
          <OrderTimeline
            status={order.status}
            placedAt={order.placedAt}
            stageDates={order.stageDates}
            cancellation={order.cancellation}
            locale={locale}
          />
        </div>
      </section>

      <section
        aria-labelledby="order-items"
        className="rounded-3xl border border-border bg-card p-5 sm:p-6"
      >
        <h2 id="order-items" className="text-sm font-semibold">
          What you ordered
        </h2>

        <OrderLines order={order} />

        <dl className="mt-4 space-y-2 border-t pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="font-medium tabular-nums">{formatMoney(totals.subtotal, order.currency)}</dd>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                Discount
                {order.discountCode && (
                  <span className="ml-1.5 font-mono text-xs uppercase text-foreground">{order.discountCode}</span>
                )}
              </dt>
              <dd className="font-medium tabular-nums text-success">
                −{formatMoney(totals.discount, order.currency)}
              </dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Delivery</dt>
            <dd className="font-medium tabular-nums">
              {totals.shipping === 0 ? 'Free' : formatMoney(totals.shipping, order.currency)}
            </dd>
          </div>
          <div className="flex justify-between border-t pt-2.5">
            <dt className="font-semibold">Total</dt>
            <dd className="text-lg font-bold tabular-nums">
              {formatMoney(totals.total, order.currency)}
            </dd>
          </div>
          {/* VAT is INCLUDED in the listed prices (lib/storefront/pricing.ts),
            * so it is stated, never added — a row that made the column stop
            * adding up would look like an overcharge. */}
          {totals.tax > 0 && (
            <p className="text-xs text-muted-foreground">
              Includes {formatMoney(totals.tax, order.currency)} VAT
            </p>
          )}
        </dl>
      </section>

      <OrderReturns order={order} locale={locale} canWithdraw={selfService === 'account'} />

      <div className="grid gap-5 sm:grid-cols-2">
        <section
          aria-labelledby="order-address"
          className="rounded-3xl border border-border bg-card p-5 sm:p-6"
        >
          <h2 id="order-address" className="text-sm font-semibold">
            Delivering to
          </h2>
          <address className="mt-3 not-italic text-sm leading-relaxed">
            {orderAddressLines(order).map((line) => (
              <span key={line} className="block text-muted-foreground first:text-foreground">
                {line}
              </span>
            ))}
          </address>
        </section>

        <section
          aria-labelledby="order-delivery"
          className="rounded-3xl border border-border bg-card p-5 sm:p-6"
        >
          <h2 id="order-delivery" className="text-sm font-semibold">
            Delivery
          </h2>
          <p className="mt-3 text-sm font-medium">{order.delivery.label}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatEtaWindow(order.delivery.eta, order.delivery.estimated, locale)}
          </p>
          {order.note && (
            <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Your note: </span>
              {order.note}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

