/*
 * /checkout/confirmation?t=…
 *
 * Also where Squad returns the shopper after paying (via
 * /api/payments/squad/callback). An unpaid order gets a "Pay now" here.
 *
 * Its own route rather than a fourth state of the checkout page, for one
 * concrete reason: the checkout navigates here with `router.replace`, so the
 * submitted checkout is gone from the history stack and the Back button
 * cannot return to it. This page only READS — there is no submit path here
 * at all, so no refresh can produce a second order.
 *
 * The order is now a real record, so this is a plain server read. `t` is the
 * order's confirmation token, which is random and unguessable; the
 * sequential reference is deliberately NOT accepted (see
 * lib/storefront/orders/read.ts).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getStoreCheckoutConfig } from '@/lib/storefront/checkout/store-config';
import { getShopper } from '@/lib/storefront/account/session';
import { getOrderByConfirmationToken } from '@/lib/storefront/orders/read';
import { getOrderPaymentState, reconcileOpenAttempts } from '@/lib/storefront/checkout/payment-service';
import { confirmationPath, storePathPrefix } from '@/lib/storefront/store-path';
import { ConfirmationView, NoOrder } from '@/components/storefront/checkout/confirmation-view';

export const metadata: Metadata = {
  title: 'Your order',
  robots: { index: false, follow: false },
};

export default async function ConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { organizationSlug } = await params;
  const { t } = await searchParams;

  const [config, shopper, organization] = await Promise.all([
    getStoreCheckoutConfig({ organizationSlug }),
    getShopper(),
    prisma.organization.findFirst({
      where: { slug: organizationSlug, status: 'ACTIVE' },
      select: { id: true },
    }),
  ]);

  if (!organization) notFound();

  const token = t?.trim();
  const row = token
    ? await prisma.order.findFirst({
        where: { organizationId: organization.id, confirmationToken: token },
        select: { id: true, paymentStatus: true },
      })
    : null;

  if (!row || !token) return <NoOrder />;

  /* The shopper usually arrives straight from Squad. Ask Squad about any
   * payment still open before reading, so the page shows the real state even
   * if the callback's own check failed or the webhook hasn't landed yet. */
  if (row.paymentStatus === 'AWAITING_PAYMENT') {
    await reconcileOpenAttempts(row.id).catch((error) => {
      console.error('[confirmation] Could not re-check payment:', error);
    });
  }

  const [order, payment, prefix] = await Promise.all([
    getOrderByConfirmationToken({ organizationId: organization.id }, token),
    getOrderPaymentState(row.id),
    storePathPrefix(organizationSlug),
  ]);

  if (!order) return <NoOrder />;

  return (
    <ConfirmationView
      order={order}
      config={config}
      signedIn={Boolean(shopper)}
      payment={{ ...payment, confirmationToken: token, confirmationPath: confirmationPath(prefix, token) }}
    />
  );
}
