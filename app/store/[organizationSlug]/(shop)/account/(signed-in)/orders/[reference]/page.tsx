/*
 * /account/orders/[reference] — one order, in full.
 *
 * The reference is looked up WITH the signed-in customer's id, so one
 * shopper cannot read another's order by typing a number — the ownership is
 * part of the query, not a check that could be forgotten.
 *
 * It shows where the order has got to, what was in it, where it's going and
 * what is still to pay — and lets the shopper cancel it before packing, or
 * ask to return items within the store's window. "Buy it again" resolves
 * against today's catalogue and says what is no longer available.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getShopper } from '@/lib/storefront/account/session';
import { BackLink } from '../../../_components/back-link';
import { getOrderForCustomer } from '@/lib/storefront/orders/read';
import { getCheckoutConfig } from '@/lib/storefront/checkout/config';
import { OrderDetail } from '@/components/storefront/orders/order-detail';
import { AccountNotFound } from '../../../_components/account-not-found';
import { prisma } from '@/lib/prisma';
import { getOrderPaymentState, reconcileOpenAttempts } from '@/lib/storefront/checkout/payment-service';
import { confirmationPath, storePathPrefix } from '@/lib/storefront/store-path';
import { formatMoney } from '@/lib/storefront/format';
import { PayNowButton } from '@/components/storefront/checkout/pay-now-button';

export const metadata: Metadata = { title: 'Your order' };

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; reference: string }>;
}) {
  const { organizationSlug, reference } = await params;
  const shopper = (await getShopper())!;

  /* Same safety net as the confirmation page: a payment that went through but
   * hasn't been heard about yet is settled before the order is shown. */
  const row = await prisma.order.findFirst({
    // Online orders only: an in-store purchase has no payment link to offer.
    where: { organizationId: shopper.organizationId, customerId: shopper.id, reference, channel: 'ONLINE' },
    select: { id: true, paymentStatus: true, confirmationToken: true },
  });
  if (row?.paymentStatus === 'AWAITING_PAYMENT') {
    await reconcileOpenAttempts(row.id).catch((error) => {
      console.error('[account order] Could not re-check payment:', error);
    });
  }

  const [order, config, payment, prefix] = await Promise.all([
    getOrderForCustomer({ organizationId: shopper.organizationId }, shopper.id, reference),
    getCheckoutConfig({ organizationSlug }),
    row ? getOrderPaymentState(row.id) : null,
    storePathPrefix(organizationSlug),
  ]);

  /* Not found and not-yours answer the same way — see AccountNotFound. */
  if (!order) {
    return (
      <AccountNotFound
        title="We can’t find that order"
        description="It isn’t on this account. Check the order number, or look through your orders below."
        backHref="/account/orders"
        backLabel="Your orders"
      />
    );
  }

  return (
    <div className="space-y-4">
      <BackLink href="/account/orders">Your orders</BackLink>

      <OrderDetail
        order={order}
        locale={config.locale}
        showReorder
        selfService="account"
        paymentAction={
          payment?.canPay && row?.confirmationToken ? (
            <div className="space-y-2">
              {payment.lastAttemptFailed && (
                <p className="text-sm text-muted-foreground">
                  Your last payment didn’t go through, and you haven’t been charged for it.
                </p>
              )}
              <PayNowButton
                target={{ reference: order.reference }}
                confirmationPath={confirmationPath(prefix, row.confirmationToken)}
                label={`Pay ${formatMoney(order.totals.total, order.currency)}`}
              />
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
