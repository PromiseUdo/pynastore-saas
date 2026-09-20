/*
 * /account/orders — everything this shopper has ordered from this store.
 *
 * Newest first, because the order someone is looking for is almost always
 * the last one. Empty is a real state: it says what will appear here and
 * offers the only useful thing to do instead.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Package } from 'lucide-react';
import { getShopper } from '@/lib/storefront/account/session';
import { listOrdersForCustomer } from '@/lib/storefront/orders/read';
import { getCheckoutConfig } from '@/lib/storefront/checkout/config';
import { OrderCard } from '@/components/storefront/orders/order-card';
import { ReviewPrompt } from '@/components/storefront/orders/review-prompt';
import { awaitingReview } from '@/lib/storefront/reviews/read';
import { AccountHeading } from '../../_components/account-heading';

export const metadata: Metadata = { title: 'Your orders' };

export default async function OrdersPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const shopper = (await getShopper())!;

  const [orders, config, toReview] = await Promise.all([
    listOrdersForCustomer({ organizationId: shopper.organizationId }, shopper.id),
    getCheckoutConfig({ organizationSlug }),
    awaitingReview({ organizationId: shopper.organizationId, customerId: shopper.id, limit: 3 }),
  ]);

  if (orders.length === 0) {
    return (
      <>
        <AccountHeading>Your orders</AccountHeading>
        <div className="rounded-3xl border border-border bg-card p-8 text-center">
        <Package className="mx-auto size-7 text-muted-foreground" aria-hidden />
        <h2 className="mt-3 font-display text-lg font-semibold">No orders yet</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
          When you order something, it appears here with its progress and everything you bought.
        </p>
          <Link
            href="/products"
            className="mt-5 inline-flex h-12 items-center rounded-full bg-brand px-6 text-base font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
          >
            Start shopping
          </Link>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <AccountHeading
        hint={`${orders.length} ${orders.length === 1 ? 'order' : 'orders'}`}
      >
        Your orders
      </AccountHeading>

      <ReviewPrompt items={toReview} />

      <ul className="space-y-4">
        {orders.map((order) => (
          <li key={order.reference}>
            <OrderCard order={order} locale={config.locale} />
          </li>
        ))}
      </ul>
    </div>
  );
}
