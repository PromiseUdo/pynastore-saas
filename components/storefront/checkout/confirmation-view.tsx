/*
 * Order confirmed.
 *
 * A PURE READER, and now a server-rendered one: the order exists in the
 * merchant's database before this page is ever reached, so there is no
 * effect that re-posts, no store to hydrate, and no path from here to a
 * second order. Refreshing is safe because refreshing is a read.
 *
 * WHAT UNLOCKS IT is the token in the URL, not the reference — see
 * lib/storefront/orders/read.ts. The reference counts upwards, so accepting
 * it here would hand the store's whole order book to anyone who can edit a
 * number.
 *
 * HONESTY. The heading only says "confirmed" once the order is PAID — and
 * PAID is only ever set by a server-side check with Squad. An unpaid order
 * says it is waiting for payment and offers "Pay now"; the payment line is
 * the order's real state with the one sentence that says what happens next.
 */
import Link from 'next/link';
import Image from 'next/image';
import { CheckCircle2, CircleAlert, Clock, Mail, PackageCheck } from 'lucide-react';
import { formatMoney, formatDate } from '@/lib/storefront/format';
import { PAYMENT_STATUS_LABEL, cancelledRefundSentence, paymentHint } from '@/lib/storefront/orders/labels';
import type { StorefrontOrder } from '@/lib/storefront/orders/types';
import type { CheckoutConfig } from '@/lib/storefront/checkout/types';
import type { OrderPaymentState } from '@/lib/storefront/checkout/payment-service';
import { OrderLines, orderAddressLines } from './order-lines';
import { PayNowButton } from './pay-now-button';
import { TransferInstructions } from '../orders/transfer-instructions';
import { OrderReturns } from '../orders/order-returns';
import { OrderSelfService } from '../orders/order-self-service';

export function ConfirmationView({
  order,
  config,
  signedIn,
  payment,
}: {
  order: StorefrontOrder;
  config: CheckoutConfig;
  /** a guest is offered an account here; a signed-in shopper is not nagged */
  signedIn: boolean;
  payment: OrderPaymentState & {
    confirmationToken: string;
    confirmationPath: string;
  };
}) {
  const { totals } = order;
  const paid = order.paymentStatus === 'PAID';
  const needsPayment = payment.canPay;
  const cancelled = order.status === 'CANCELLED';
  const timedOut = cancelled && payment.cancelReason === 'payment-timeout';
  /* Cancelled after the money arrived: the store owes it back, or has sent it. */
  const refundDue = cancelled && (order.refunds.owed > 0 || order.refunds.total > 0);
  const selfService = order.selfService.canCancel || order.selfService.returns.open;

  function subtitle(): string {
    if (refundDue) return cancelledRefundSentence(order, config.locale);
    if (timedOut) {
      return 'We didn’t receive your payment in time, so the items went back on sale. You haven’t been charged — you’re welcome to order again.';
    }
    if (cancelled) {
      return `${order.cancellation?.by === 'customer' ? 'You cancelled it' : 'The store cancelled it'}, and its items went back on sale. You haven’t been charged for it.`;
    }
    if (needsPayment) return 'We’ve saved your order. It will be confirmed as soon as your payment goes through.';
    if (awaitingTransfer) {
      return 'We’ve saved your order and set the items aside. Send the transfer below — the store confirms your order once the money arrives.';
    }
    return `Thank you${order.contact.firstName ? `, ${order.contact.firstName}` : ''}. We’ve got your order and we’ll let you know as soon as it’s on the way.`;
  }
  const awaitingTransfer = !cancelled && order.paymentStatus === 'AWAITING_TRANSFER';

  return (
    <div className="mx-auto max-w-2xl">
      <header className="text-center">
        {cancelled ? (
          <CircleAlert className="mx-auto size-12 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        ) : needsPayment || awaitingTransfer ? (
          <Clock className="mx-auto size-12 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        ) : (
          <CheckCircle2 className="mx-auto size-12 text-success" strokeWidth={1.5} aria-hidden />
        )}
        <h1 className="mt-4 font-display text-2xl sm:text-3xl">
          {cancelled
            ? 'This order was cancelled'
            : paid
              ? 'Order confirmed'
              : needsPayment
                ? 'Your order is waiting for payment'
                : awaitingTransfer
                  ? 'Your order is waiting for your transfer'
                  : 'Order received'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {subtitle()}
        </p>

        <p className="mt-5 inline-flex items-baseline gap-2 rounded-full border bg-card px-4 py-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Order</span>
          <span className="font-semibold tabular-nums">{order.reference}</span>
        </p>
      </header>

      <p className="mt-6 flex items-start gap-2.5 rounded-xl border bg-secondary/40 p-4 text-sm leading-relaxed">
        <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>
          We’ll send updates about this order to{' '}
          <strong className="font-semibold">{order.contact.email}</strong>.
        </span>
      </p>

      {/* What the shopper still has to do, if anything. A cancelled order has
        * nothing left to pay; if money is owed back, the heading says so. */}
      {!cancelled && (
        <div className="mt-4 rounded-xl border border-brand/30 bg-brand/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            {payment.lastAttemptFailed ? (
              <CircleAlert className="size-4 text-destructive" aria-hidden />
            ) : (
              <PackageCheck className="size-4" aria-hidden />
            )}
            {payment.lastAttemptFailed
              ? 'Payment didn’t go through'
              : PAYMENT_STATUS_LABEL[order.paymentStatus]}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {payment.lastAttemptFailed
              ? 'Your payment was cancelled or declined, and you haven’t been charged for it. You can try again below.'
              : needsPayment
                ? 'If you’ve just paid, it can take a minute to show here — refresh this page before paying again.'
                : paymentHint(order.paymentStatus)}
          </p>
          {needsPayment && (
            <div className="mt-4">
              <PayNowButton
                target={{ confirmationToken: payment.confirmationToken }}
                confirmationPath={payment.confirmationPath}
                label={`Pay ${formatMoney(totals.total, order.currency)}`}
              />
            </div>
          )}
        </div>
      )}

      {order.paymentStatus === 'AWAITING_TRANSFER' && !cancelled && order.transferDetails && (
        <div className="mt-4">
          <TransferInstructions
            accounts={order.transferDetails}
            total={totals.total}
            currency={order.currency}
            reference={order.reference}
          />
        </div>
      )}

      <section aria-labelledby="confirmation-summary" className="mt-7 rounded-2xl border bg-card p-5">
        <h2 id="confirmation-summary" className="font-display text-lg">
          Order summary
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {order.itemCount} item{order.itemCount === 1 ? '' : 's'} · placed{' '}
          {formatDate(order.placedAt, config.locale)}
        </p>

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
            <dd className="text-lg font-bold tabular-nums">{formatMoney(totals.total, order.currency)}</dd>
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

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="confirmation-address" className="rounded-2xl border bg-card p-5">
          <h2
            id="confirmation-address"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Delivering to
          </h2>
          <div className="mt-2 text-sm leading-relaxed">
            {orderAddressLines(order).map((line) => (
              <p key={line} className="text-muted-foreground first:font-medium first:text-foreground">
                {line}
              </p>
            ))}
          </div>
        </section>

        <section aria-labelledby="confirmation-delivery" className="rounded-2xl border bg-card p-5">
          <h2
            id="confirmation-delivery"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Delivery
          </h2>
          <p className="mt-2 text-sm font-medium">{order.delivery.label}</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Estimated {formatDate(order.delivery.estimated.from, config.locale)} –{' '}
            {formatDate(order.delivery.estimated.to, config.locale)}
          </p>
          {order.note && (
            <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Your note: </span>
              {order.note}
            </p>
          )}
        </section>
      </div>

      {/* Offered once, after the order is safely placed — never before, and
       * never as a condition of ordering. */}
      {!signedIn && (
        <div className="mt-8 rounded-2xl border border-border bg-card p-5 text-center">
          <p className="text-sm font-semibold">Keep track of this order</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Create an account with {order.contact.email} and this order — and your delivery address — are
            waiting for you next time.
          </p>
          <Link
            href={`/account/register?next=${encodeURIComponent('/account/orders')}`}
            className="mt-4 inline-flex h-11 items-center rounded-full border border-border px-5 text-sm font-semibold transition-colors hover:border-brand hover:text-brand"
          >
            Create an account
          </Link>
        </div>
      )}

      {order.returns.length > 0 && (
        <div className="mt-4">
          <OrderReturns order={order} locale={config.locale} canWithdraw={false} />
        </div>
      )}

      {/* Cancelling and returns live on the account's order page, where the
        * session proves whose order it is — this page is opened by a link. */}
      {selfService &&
        (signedIn ? (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {order.selfService.canCancel
              ? 'Changed your mind? You can cancel from your order page until the store starts packing.'
              : 'Need to send something back? You can ask for a return from your order page.'}
          </p>
        ) : (
          <div className="mt-6">
            <OrderSelfService order={order} mode="guest" locale={config.locale} />
          </div>
        ))}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {signedIn && (
          <Link
            href={`/account/orders/${order.reference}`}
            className="inline-flex h-12 items-center rounded-full border px-7 text-sm font-semibold transition-colors hover:border-brand hover:text-brand"
          >
            View this order
          </Link>
        )}
        <Link
          href="/products"
          className="inline-flex h-12 items-center rounded-full bg-brand px-7 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
        >
          Continue shopping
        </Link>
      </div>

      <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
        Keep your order number handy — you’ll need it if you get in touch about this order, or to track it
        without signing in.
      </p>
    </div>
  );
}

/**
 * Someone reached the confirmation without a usable link: a shared URL with
 * the token stripped, an old bookmark, a different store. Not an error — but
 * it must not pretend there is an order to show.
 */
export function NoOrder() {
  return (
    <div className="mx-auto max-w-md rounded-2xl border bg-card px-6 py-14 text-center">
      <h1 className="font-display text-xl sm:text-2xl">No order to show</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        This link doesn’t open an order. If you’ve just ordered, check your email for the confirmation — it
        has your order number in it, and you can look the order up with that.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link
          href="/track-order"
          className="inline-flex h-11 items-center rounded-full bg-brand px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
        >
          Track an order
        </Link>
        <Link
          href="/products"
          className="inline-flex h-11 items-center rounded-full border px-6 text-sm font-semibold transition-colors hover:border-brand hover:text-brand"
        >
          Continue shopping
        </Link>
      </div>
    </div>
  );
}
