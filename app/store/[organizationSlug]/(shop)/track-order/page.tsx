/*
 * /track-order
 *
 * Where the footer's "Track your order" leads. Deliberately outside the
 * account area: the people who need it most are the ones who checked out as
 * guests, and asking them to make an account to see the order they already
 * placed would be the wrong way round.
 *
 * A signed-in shopper is sent to their own list instead, where they don't
 * need the order number at all.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getShopper } from '@/lib/storefront/account/session';
import { getCheckoutConfig } from '@/lib/storefront/checkout/config';
import { TrackOrderForm } from '@/components/storefront/orders/track-order-form';

export const metadata: Metadata = {
  title: 'Track your order',
  robots: { index: false, follow: false },
};

export default async function TrackOrderPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const shopper = await getShopper();
  if (shopper) redirect('/account/orders');

  const config = await getCheckoutConfig({ organizationSlug });

  return (
    <div className="sf-container py-10 sm:py-14">
      <div className="mx-auto w-full max-w-[42rem]">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Track your order
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Enter your order number and the email you ordered with.
        </p>

        <div className="mt-7 rounded-3xl border border-border bg-card p-5 sm:p-6">
          <TrackOrderForm locale={config.locale} />
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Have an account?{' '}
          <Link
            href="/account/sign-in?next=%2Faccount%2Forders"
            className="font-semibold text-brand underline underline-offset-4"
          >
            Sign in
          </Link>{' '}
          to see all your orders.
        </p>
      </div>
    </div>
  );
}
