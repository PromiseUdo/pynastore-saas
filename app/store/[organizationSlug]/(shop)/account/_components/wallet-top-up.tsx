'use client';

/*
 * Adding money to the shopper's wallet (ROADMAP 20.3), in three steps on
 * this page: choose an amount → see EduPay's charges and the total → pay in
 * Paystack's window, which opens over the page (no redirect). Afterwards the
 * page asks the server, which asks EduPay, until the money has landed; it
 * never says "added" on Paystack's word alone.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import {
  checkShopperTopUpAction,
  startShopperTopUpAction,
  type StartTopUpResult,
} from '@/features/shop-account/wallet-actions';
import { TextField } from '@/components/storefront/checkout/checkout-fields';
import { formatMoney } from '@/lib/storefront/format';
import { openPaystackWindow } from '@/lib/wallet/paystack-window';
import { cn } from '@/lib/utils';
import { AuthError } from './auth-shell';

const QUICK = [1000, 5000, 10000, 20000];
const naira = (amount: number) => formatMoney(Math.round(amount * 100));
const POLL_MS = 3000;
const POLL_TRIES = 20;

type Started = Extract<StartTopUpResult, { ok: true }>;
type Step =
  | { name: 'amount' }
  | { name: 'confirm'; started: Started }
  | { name: 'adding'; amount: number }
  | { name: 'done'; amount: number }
  | { name: 'slow'; amount: number };

const primary =
  'flex h-12 w-full items-center justify-center gap-2 rounded-(--sf-radius-button) bg-brand text-base font-semibold text-primary-foreground transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60';
const quiet = 'text-sm font-medium text-foreground underline underline-offset-4 hover:text-brand';

/** Ask until EduPay confirms, or give up politely — the job settles it later either way. */
async function waitForLanding(topUpId: string): Promise<'done' | 'failed' | 'slow'> {
  for (let i = 0; i < POLL_TRIES; i++) {
    const { status } = await checkShopperTopUpAction(topUpId, true);
    if (status === 'COMPLETED') return 'done';
    if (status === 'FAILED' || status === 'EXPIRED' || status === 'gone') return 'failed';
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return 'slow';
}

export function WalletTopUp() {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>({ name: 'amount' });
  const [amount, setAmount] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldError(null);
    const result = await startShopperTopUpAction(amount);
    setPending(false);
    if (!result.ok) {
      if (result.field) setFieldError(result.error);
      else setError(result.error);
      return;
    }
    setStep({ name: 'confirm', started: result });
  }

  async function pay(started: Started) {
    setPending(true);
    setError(null);
    const outcome = await openPaystackWindow(started.accessCode).catch(() => 'error' as const);
    if (outcome !== 'paid') {
      setPending(false);
      if (outcome === 'error') setError('Paystack’s payment window couldn’t open. Please try again.');
      return; // closed: stay on the confirm step, so they can pay or go back
    }
    setStep({ name: 'adding', amount: started.amount });
    const landed = await waitForLanding(started.topUpId);
    setPending(false);
    if (landed === 'done') {
      setStep({ name: 'done', amount: started.amount });
      router.refresh();
    } else if (landed === 'slow') {
      setStep({ name: 'slow', amount: started.amount });
    } else {
      setStep({ name: 'confirm', started });
      setError('EduPay says this payment didn’t go through. Please try again.');
    }
  }

  function again() {
    setStep({ name: 'amount' });
    setAmount('');
    setError(null);
  }

  if (step.name === 'adding') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Payment received. Adding {naira(step.amount)} to your wallet…
      </p>
    );
  }

  if (step.name === 'done' || step.name === 'slow') {
    return (
      <div role="status" className="space-y-3">
        <p className="flex items-start gap-2 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          {step.name === 'done'
            ? `${naira(step.amount)} added to your wallet.`
            : `Paystack has your payment. ${naira(step.amount)} will appear in your wallet shortly — you can leave this page.`}
        </p>
        <button type="button" onClick={again} className={quiet}>
          Add more money
        </button>
      </div>
    );
  }

  if (step.name === 'confirm') {
    const { started } = step;
    return (
      <div className="space-y-4">
        {error && <AuthError>{error}</AuthError>}
        <dl className="space-y-2 rounded-2xl bg-secondary/60 p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Added to your wallet</dt>
            <dd className="tabular-nums">{naira(started.amount)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">EduPay and Paystack charges</dt>
            <dd className="tabular-nums">{naira(started.fee)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-border pt-2 font-semibold">
            <dt>You pay</dt>
            <dd className="tabular-nums">{naira(started.total)}</dd>
          </div>
        </dl>
        <button type="button" className={primary} disabled={pending} onClick={() => pay(started)}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Pay {naira(started.total)}
        </button>
        <p className="text-center text-xs text-muted-foreground">
          Card, bank transfer or USSD, through Paystack. The charges are EduPay’s and Paystack’s, not the store’s.
        </p>
        <button type="button" onClick={again} disabled={pending} className={cn(quiet, 'block w-full text-center')}>
          Change the amount
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={start} className="space-y-4" noValidate>
      {error && <AuthError>{error}</AuthError>}
      <div className="flex flex-wrap gap-2">
        {QUICK.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setAmount(String(value))}
            className={cn(
              'h-9 rounded-(--sf-radius-button) border px-4 text-sm font-medium tabular-nums transition-colors hover:border-brand',
              amount === String(value) ? 'border-brand bg-brand/10' : 'border-border',
            )}
          >
            {naira(value)}
          </button>
        ))}
      </div>
      <TextField
        id="wallet-top-up-amount"
        name="amount"
        label="Amount"
        inputMode="numeric"
        placeholder="5,000"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={fieldError ?? undefined}
        hint="In naira. You’ll see the charges before you pay."
        required
      />
      <button type="submit" className={primary} disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {pending ? 'Working out the charges…' : 'Continue'}
      </button>
    </form>
  );
}

/**
 * Top-ups paid but not yet confirmed by EduPay — someone who left the page
 * mid-wait sees them here, and can ask again rather than wait for the job.
 */
export function PendingTopUps({ items }: { items: { id: string; amount: number }[] }) {
  const router = useRouter();
  const [checking, setChecking] = React.useState<string | null>(null);

  async function check(id: string) {
    setChecking(id);
    await checkShopperTopUpAction(id, true);
    setChecking(null);
    router.refresh();
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3 rounded-2xl bg-secondary/60 px-4 py-3 text-sm">
          <span>Adding {naira(item.amount)} — waiting for EduPay to confirm.</span>
          <button type="button" onClick={() => check(item.id)} disabled={checking !== null} className={cn(quiet, 'shrink-0')}>
            {checking === item.id ? 'Checking…' : 'Check now'}
          </button>
        </li>
      ))}
    </ul>
  );
}
