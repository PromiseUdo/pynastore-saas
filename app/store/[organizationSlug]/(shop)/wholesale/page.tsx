/*
 * /wholesale — "Buy wholesale" (ROADMAP 21.1). Says what a trade account is
 * at this shop and how to get one. The asking itself happens in the
 * shopper's account (/account/trade), where we know who they are. Only
 * exists while the shop sells wholesale.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getShopper } from '@/lib/storefront/account/session';
import {
  getWholesaleSettingsBySlug,
  tradeStanding,
} from '@/lib/trade/accounts';

export const metadata: Metadata = { title: 'Buy wholesale' };

const BUTTON =
  'inline-flex h-12 items-center justify-center rounded-[var(--sf-radius-button,999px)] px-6 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export default async function WholesalePage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const settings = await getWholesaleSettingsBySlug(organizationSlug);
  if (settings.mode === 'OFF' || !settings.organizationId) notFound();

  const shopper = await getShopper();
  const standing =
    shopper && shopper.organizationId === settings.organizationId
      ? await tradeStanding(shopper.organizationId, shopper.id)
      : null;
  const next = encodeURIComponent('/account/trade');

  return (
    <div className="sf-container py-10 sm:py-14">
      <div className="mx-auto w-full max-w-[42rem]">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Buy wholesale
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {settings.mode === 'TRADE_ONLY'
            ? 'This shop sells to businesses. Approved trade buyers can see the products and order.'
            : 'If you buy for a business, you can shop here as a trade buyer.'}
        </p>

        <div className="mt-7 space-y-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
          {standing?.status === 'APPROVED' ? (
            <>
              <p className="text-sm">
                You’re a trade buyer here, as {standing.businessName}.
              </p>
              <Link
                href={
                  settings.mode === 'TRADE_ONLY'
                    ? '/products'
                    : '/account/trade'
                }
                className={`${BUTTON} bg-brand text-primary-foreground hover:opacity-90`}
              >
                {settings.mode === 'TRADE_ONLY'
                  ? 'Start shopping'
                  : 'See your trade account'}
              </Link>
            </>
          ) : standing ? (
            <>
              <p className="text-sm">
                You’ve already been in touch about a trade account. See where it
                stands in your account.
              </p>
              <Link
                href="/account/trade"
                className={`${BUTTON} bg-brand text-primary-foreground hover:opacity-90`}
              >
                See your trade account
              </Link>
            </>
          ) : settings.requestsOpen ? (
            <>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                <li>
                  {shopper
                    ? 'Send your business details from your account.'
                    : 'Sign in, or create an account.'}
                </li>
                {!shopper && (
                  <li>Send your business details from your account.</li>
                )}
                <li>The store checks them and emails you their answer.</li>
              </ol>
              {shopper ? (
                <Link
                  href="/account/trade"
                  className={`${BUTTON} bg-brand text-primary-foreground hover:opacity-90`}
                >
                  Ask for a trade account
                </Link>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <Link
                    href={`/account/sign-in?next=${next}`}
                    className={`${BUTTON} bg-brand text-primary-foreground hover:opacity-90`}
                  >
                    Sign in
                  </Link>
                  <Link
                    href={`/account/register?next=${next}`}
                    className={`${BUTTON} border border-border hover:border-brand hover:text-brand`}
                  >
                    Create an account
                  </Link>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-sm">
                Trade accounts here are by invitation: the store sets them up
                for the businesses it supplies. Please get in touch with them if
                you’d like one.
              </p>
              {!shopper && (
                <p className="text-sm text-muted-foreground">
                  Already invited?{' '}
                  <Link
                    href={`/account/sign-in?next=${next}`}
                    className="font-semibold text-brand underline underline-offset-4"
                  >
                    Sign in
                  </Link>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
