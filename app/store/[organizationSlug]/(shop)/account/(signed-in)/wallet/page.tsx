/*
 * /account/wallet — the shopper's EduPay wallet (ROADMAP 20.2).
 *
 * The balance and the latest transactions, straight from EduPay on every
 * load; the PIN (20.3); and adding money with Paystack, in Paystack's
 * window on this page (20.3). Paying for orders from the wallet is 20.5.
 *
 * Opening this page is also how an account made before wallets gets one,
 * which is why it says what is shared with EduPay.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, Clock, TriangleAlert, Wallet } from 'lucide-react';
import { getShopper } from '@/lib/storefront/account/session';
import { formatDate, formatMoney, formatTime } from '@/lib/storefront/format';
import { shopperWalletView } from '@/lib/wallet/shopper';
import type { WalletTransaction } from '@/lib/wallet/edupay';
import { AccountHeading } from '../../_components/account-heading';
import { ChangePinForm, CreatePinForm } from '../../_components/wallet-pin-form';
import { PendingTopUps, WalletTopUp } from '../../_components/wallet-top-up';
import { pendingTopUps } from '@/lib/wallet/top-up';
import type { PinStatus } from '@/lib/wallet/edupay';

export const metadata: Metadata = { title: 'Your wallet' };

const linkClass = 'font-medium text-foreground underline underline-offset-4 hover:text-brand';

function Notice({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Wallet;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-border bg-card p-8 text-center">
      <Icon className="mx-auto size-7 text-muted-foreground" aria-hidden />
      <h2 className="mt-3 font-display text-lg font-semibold">{title}</h2>
      <div className="mx-auto mt-1.5 max-w-sm space-y-2 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

function PoweredBy() {
  return (
    <p className="mt-6 text-center text-xs text-muted-foreground">
      Your wallet is provided by EduPay. We share your name, email and phone number with EduPay to set it up.
    </p>
  );
}

/** Create the PIN, or — once there is one — change it. */
function PinSection({ pin }: { pin: PinStatus }) {
  if (!pin.isSet) {
    return (
      <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
        <h2 className="font-display text-lg font-semibold">Create your wallet PIN</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          You’ll use this 4-digit PIN to approve payments from your wallet. Don’t share it with anyone, including the
          store.
        </p>
        <CreatePinForm />
      </section>
    );
  }
  return (
    <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
      <h2 className="font-display text-lg font-semibold">Wallet PIN</h2>
      {pin.isLocked ? (
        <p className="mt-1 text-sm text-destructive">
          Your PIN is locked after too many wrong tries
          {pin.lockedUntil ? `, until ${formatTime(pin.lockedUntil)} on ${formatDate(pin.lockedUntil)}` : ''}.
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Your PIN is set. It approves payments from your wallet.</p>
      )}
      <details className="mt-4 group">
        <summary className="cursor-pointer text-sm font-medium text-foreground underline underline-offset-4 hover:text-brand">
          Change your PIN
        </summary>
        <div className="mt-4">
          <ChangePinForm />
        </div>
      </details>
      <p className="mt-4 text-xs text-muted-foreground">Forgot your PIN? Resetting it here isn’t available yet.</p>
    </section>
  );
}

function TransactionRow({ tx, currency }: { tx: WalletTransaction; currency: string }) {
  const credit = tx.direction === 'credit';
  const Icon = credit ? ArrowDownLeft : ArrowUpRight;
  return (
    <li className="flex items-center gap-3 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary" aria-hidden>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{tx.description ?? (credit ? 'Money in' : 'Money out')}</p>
        <p className="text-xs text-muted-foreground">
          {tx.createdAt ? formatDate(tx.createdAt) : '—'}
          {tx.status && tx.status !== 'completed' && tx.status !== 'success' ? ` · ${tx.status}` : ''}
        </p>
      </div>
      <p className={`shrink-0 text-sm font-semibold tabular-nums ${credit ? 'text-brand' : ''}`}>
        <span className="sr-only">{credit ? 'Received' : 'Spent'} </span>
        {credit ? '+' : '−'}
        {formatMoney(tx.amountKobo, currency)}
      </p>
    </li>
  );
}

export default async function WalletPage() {
  const shopper = (await getShopper())!;
  const view = await shopperWalletView(shopper.id);

  if (view.state === 'unavailable') {
    return (
      <>
        <AccountHeading>Your wallet</AccountHeading>
        <Notice icon={Wallet} title="Wallets aren’t available yet">
          <p>This store doesn’t offer wallets yet.</p>
        </Notice>
      </>
    );
  }

  if (view.state === 'setting-up') {
    return (
      <>
        <AccountHeading>Your wallet</AccountHeading>
        <Notice icon={Clock} title="Setting up your wallet">
          <p>This usually takes a moment.</p>
          <p>
            <Link href="/account/wallet" className={linkClass}>
              Check again
            </Link>
          </p>
        </Notice>
        <PoweredBy />
      </>
    );
  }

  if (view.state === 'phone-in-use') {
    return (
      <>
        <AccountHeading>Your wallet</AccountHeading>
        <Notice icon={TriangleAlert} title="Your phone number is used by another wallet">
          <p>Another EduPay wallet already uses your phone number, so we can’t set up yours with it.</p>
          <p>
            <Link href="/account/profile" className={linkClass}>
              Use a different number
            </Link>{' '}
            and we’ll set up your wallet straight away. If that wallet is yours, change your account email to the one
            it uses instead.
          </p>
        </Notice>
        <PoweredBy />
      </>
    );
  }

  if (view.state === 'problem') {
    return (
      <>
        <AccountHeading>Your wallet</AccountHeading>
        <Notice icon={TriangleAlert} title="We couldn’t set up your wallet">
          <p>Something went wrong on our side. Please try again later.</p>
        </Notice>
        <PoweredBy />
      </>
    );
  }

  const { wallet, transactions, origin } = view;
  const pending = await pendingTopUps({ kind: 'SHOPPER', organizationId: shopper.organizationId, customerId: shopper.id });
  const currency = wallet?.currency ?? 'NGN';

  return (
    <div className="space-y-4">
      <AccountHeading hint={origin === 'CONNECTED' ? 'This is your existing EduPay wallet.' : undefined}>
        Your wallet
      </AccountHeading>

      <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-muted-foreground">Balance</h2>
        {wallet ? (
          <p className="mt-1 font-display text-3xl font-semibold tabular-nums">
            {formatMoney(wallet.balanceKobo, currency)}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            We couldn’t reach EduPay just now.{' '}
            <Link href="/account/wallet" className={linkClass}>
              Try again
            </Link>
          </p>
        )}
      </section>

      <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
        <h2 className="font-display text-lg font-semibold">Add money</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">Top up with your card, a bank transfer or USSD.</p>
        {pending.length > 0 && (
          <div className="mb-4">
            <PendingTopUps items={pending} />
          </div>
        )}
        <WalletTopUp />
      </section>

      {view.pin && <PinSection pin={view.pin} />}

      <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
        <h2 className="font-display text-lg font-semibold">Recent activity</h2>
        {transactions === null ? (
          <p className="mt-2 text-sm text-muted-foreground">We couldn’t load your transactions just now.</p>
        ) : transactions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-border">
            {transactions.map((tx) => (
              <TransactionRow key={tx.reference} tx={tx} currency={currency} />
            ))}
          </ul>
        )}
      </section>

      <PoweredBy />
    </div>
  );
}
