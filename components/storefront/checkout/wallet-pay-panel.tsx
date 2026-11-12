'use client';

/*
 * "Pay from wallet" for an order waiting for payment (ROADMAP 20.5): the
 * wallet balance, what the order costs, and the 4-digit PIN that confirms
 * it. The server decides everything — whose order, whose wallet, whether
 * it's paid (lib/storefront/checkout/wallet-payment.ts); this only asks,
 * shows it's asking, and refreshes the page once EduPay has said yes.
 *
 * Short of money, the shopper adds some right here (`topUp`, the Wallet
 * page's own top-up) and then pays. The PIN is never kept after a try.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { payFromWalletAction } from '@/features/shop-orders/actions';
import type { WalletPayView } from '@/lib/storefront/checkout/wallet-payment';
import { formatMoney } from '@/lib/storefront/format';
import { TextField } from './checkout-fields';

const primary =
  'inline-flex h-12 items-center justify-center gap-2 rounded-[var(--sf-radius-button,999px)] bg-brand px-7 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover disabled:opacity-70';
const quiet = 'text-sm font-medium text-foreground underline underline-offset-4 hover:text-brand';

export function WalletPayPanel({
  target,
  view,
  checking,
  walletHref,
  signInHref,
  topUp,
}: {
  target: { confirmationToken: string } | { reference: string };
  view: WalletPayView;
  /** an earlier try EduPay hasn't answered yet */
  checking: boolean;
  /** Account → Wallet, for creating the PIN */
  walletHref: string;
  signInHref: string;
  /** the shopper's top-up, shown when the balance is short */
  topUp?: React.ReactNode;
}) {
  const router = useRouter();
  const [pin, setPin] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; field?: 'pin' } | null>(null);

  if (checking) {
    return (
      <div role="status" className="space-y-3 text-sm">
        <p>We’re checking your wallet payment with EduPay. Please don’t pay again — this takes a minute or two.</p>
        <button type="button" className={quiet} onClick={() => router.refresh()}>
          Check again
        </button>
      </div>
    );
  }

  if (view.state === 'sign-in') {
    return (
      <p className="text-sm">
        <Link href={signInHref} className={quiet}>
          Sign in
        </Link>{' '}
        with the account that placed this order to pay from its wallet.
      </p>
    );
  }

  if (view.state === 'unavailable') {
    return (
      <div className="space-y-3 text-sm">
        <p>We couldn’t reach your wallet just now. You haven’t been charged.</p>
        <button type="button" className={quiet} onClick={() => router.refresh()}>
          Try again
        </button>
      </div>
    );
  }

  const short = view.balanceKobo < view.totalKobo;

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!/^\d{4}$/.test(pin)) {
      setError({ message: 'Enter your 4-digit wallet PIN.', field: 'pin' });
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await payFromWalletAction(target, pin);
      setPin('');
      if (result.ok) {
        toast.success('Paid from your wallet');
        router.refresh();
        return;
      }
      setError({ message: result.message, field: result.field });
      // An unanswered payment shows as "checking" once the page reloads.
      if (result.checking) router.refresh();
    } catch {
      setError({ message: 'We couldn’t reach the store just now. Please refresh this page before trying again.' });
    }
    setPending(false);
  }

  return (
    <div className="space-y-4">
      <dl className="space-y-2 rounded-xl bg-background/60 p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="flex items-center gap-2 text-muted-foreground">
            <Wallet className="size-4" aria-hidden />
            Your wallet
          </dt>
          <dd className="tabular-nums">{formatMoney(view.balanceKobo)}</dd>
        </div>
        <div className="flex justify-between gap-4 font-semibold">
          <dt>This order</dt>
          <dd className="tabular-nums">{formatMoney(view.totalKobo)}</dd>
        </div>
      </dl>

      {short ? (
        <div className="space-y-3">
          <p className="text-sm">
            You need <strong className="tabular-nums">{formatMoney(view.totalKobo - view.balanceKobo)}</strong> more. Add
            money to your wallet, then pay.
          </p>
          {topUp}
        </div>
      ) : !view.pinSet ? (
        <p className="text-sm">
          Wallet payments are confirmed with a PIN.{' '}
          <Link href={walletHref} className={quiet}>
            Create your wallet PIN
          </Link>
          , then come back to this order.
        </p>
      ) : view.pinLocked ? (
        <p className="text-sm">Your wallet PIN is locked after too many wrong tries. Please try again later.</p>
      ) : (
        <form onSubmit={pay} noValidate className="space-y-4">
          {error && !error.field && (
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error.message}
            </p>
          )}
          <TextField
            id="wallet-pay-pin"
            name="pin"
            label="Wallet PIN"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="off"
            className="tracking-[0.5em] tabular-nums"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            error={error?.field === 'pin' ? error.message : undefined}
            hint="The 4-digit PIN you created for your wallet."
            required
          />
          <button type="submit" className={primary} disabled={pending} aria-busy={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {pending ? 'Paying…' : `Pay ${formatMoney(view.totalKobo)} from wallet`}
          </button>
          <p className="text-xs text-muted-foreground">Powered by EduPay. The money goes straight to the store’s wallet.</p>
        </form>
      )}
    </div>
  );
}
