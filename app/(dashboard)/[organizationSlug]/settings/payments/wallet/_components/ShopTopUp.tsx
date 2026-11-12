'use client';

/*
 * Adding money to the shop wallet (ROADMAP 20.3) — mostly so there's enough
 * to send refunds (20.6). Same three steps as a shopper's top-up: amount →
 * EduPay's charges and the total → Paystack's window over the page. Then the
 * dialog asks the server, which asks EduPay, until the money has landed.
 *
 * Hidden inside the business app, where nothing is bought (19.3).
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog';
import { useNoBuying } from '@/components/business-app/no-buying';
import { checkShopTopUp, startShopTopUp, type ShopTopUpStart } from '@/features/settings/shop-wallet';
import { formatMoney } from '@/lib/format';
import { openPaystackWindow } from '@/lib/wallet/paystack-window';

type Started = Extract<ShopTopUpStart, { success: true }>;
type Step = { name: 'amount' } | { name: 'confirm'; started: Started } | { name: 'adding'; amount: number } | { name: 'slow'; amount: number };

const POLL_MS = 3000;
const POLL_TRIES = 20;

async function waitForLanding(topUpId: string): Promise<'done' | 'failed' | 'slow'> {
  for (let i = 0; i < POLL_TRIES; i++) {
    const { status } = await checkShopTopUp(topUpId, true);
    if (status === 'COMPLETED') return 'done';
    if (status === 'FAILED' || status === 'EXPIRED' || status === 'gone') return 'failed';
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return 'slow';
}

export function ShopTopUpButton() {
  const router = useRouter();
  const noBuying = useNoBuying();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>({ name: 'amount' });
  const [amount, setAmount] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<string | null>(null);

  if (noBuying) return null;

  function openDialog(next: boolean) {
    // Mid-payment, the dialog stays (closing it wouldn't stop Paystack), and
    // "Add money" can't start a second one.
    if (step.name === 'adding' || pending) return;
    setOpen(next);
    if (next) {
      setStep({ name: 'amount' });
      setAmount('');
      setError(null);
      setFieldError(null);
    }
  }

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldError(null);
    const result = await startShopTopUp(amount);
    setPending(false);
    if (!result.success) {
      if (result.field) setFieldError(result.error);
      else setError(result.error);
      return;
    }
    setStep({ name: 'confirm', started: result });
  }

  async function pay(started: Started) {
    setPending(true);
    setError(null);
    // Paystack's window is a frame on <body>, outside this dialog — and a
    // modal dialog makes everything outside it unclickable. So the dialog
    // steps aside while Paystack is open, and comes back for what follows.
    setOpen(false);
    const outcome = await openPaystackWindow(started.accessCode).catch(() => 'error' as const);
    setOpen(true);
    if (outcome !== 'paid') {
      setPending(false);
      if (outcome === 'error') setError('Paystack’s payment window couldn’t open. Please try again.');
      return;
    }
    setStep({ name: 'adding', amount: started.amount });
    const landed = await waitForLanding(started.topUpId);
    setPending(false);
    if (landed === 'done') {
      toast.success(`${formatMoney(started.amount)} added to the shop wallet`);
      setOpen(false);
      router.refresh();
    } else if (landed === 'slow') {
      setStep({ name: 'slow', amount: started.amount });
    } else {
      setStep({ name: 'confirm', started });
      setError('EduPay says this payment didn’t go through. Please try again.');
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => openDialog(true)}>
        <Plus className="size-3.5" />
        Add money
      </Button>

      <DialogRoot open={open} onOpenChange={openDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add money to the shop wallet</DialogTitle>
            <DialogDescription>Pay by card, bank transfer or USSD through Paystack. You’ll see the charges first.</DialogDescription>
          </DialogHeader>

          {error && (
            <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {step.name === 'amount' && (
            <form onSubmit={start} noValidate>
              <div className="mt-4">
                <Field>
                  <Label htmlFor="shop-top-up-amount">Amount (₦) *</Label>
                  <Input
                    id="shop-top-up-amount"
                    inputMode="numeric"
                    placeholder="20,000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    aria-invalid={fieldError ? true : undefined}
                    className="w-48 tabular-nums"
                  />
                  {fieldError ? <FieldError>{fieldError}</FieldError> : <FieldDescription>Whole naira.</FieldDescription>}
                </Field>
              </div>
              <DialogFooter className="mt-6">
                <DialogClose asChild>
                  <Button type="button" variant="outline" size="sm">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" size="sm" disabled={pending}>
                  {pending && <Loader2 className="size-3.5 animate-spin" />}
                  See the charges
                </Button>
              </DialogFooter>
            </form>
          )}

          {step.name === 'confirm' && (
            <>
              <dl className="mt-4 space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Added to the wallet</dt>
                  <dd className="tabular-nums">{formatMoney(step.started.amount)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">EduPay and Paystack charges</dt>
                  <dd className="tabular-nums">{formatMoney(step.started.fee)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t pt-2 font-semibold">
                  <dt>You pay</dt>
                  <dd className="tabular-nums">{formatMoney(step.started.total)}</dd>
                </div>
              </dl>
              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setStep({ name: 'amount' })}>
                  Change the amount
                </Button>
                <Button type="button" size="sm" disabled={pending} onClick={() => pay(step.started)}>
                  {pending && <Loader2 className="size-3.5 animate-spin" />}
                  Pay {formatMoney(step.started.total)}
                </Button>
              </DialogFooter>
            </>
          )}

          {step.name === 'adding' && (
            <p role="status" className="mt-4 flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Payment received. Adding {formatMoney(step.amount)} to the shop wallet…
            </p>
          )}

          {step.name === 'slow' && (
            <>
              <p role="status" className="mt-4 text-sm">
                Paystack has the payment. {formatMoney(step.amount)} will appear in the shop wallet shortly — you can close
                this.
              </p>
              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    router.refresh();
                  }}
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </DialogRoot>
    </>
  );
}

/** Paid top-ups EduPay hasn't confirmed yet, with a way to ask again. */
export function PendingShopTopUps({ items }: { items: { id: string; amount: number }[] }) {
  const router = useRouter();
  const [checking, setChecking] = React.useState<string | null>(null);

  async function check(id: string) {
    setChecking(id);
    const { status } = await checkShopTopUp(id, true);
    setChecking(null);
    if (status === 'COMPLETED') toast.success('Top-up added to the shop wallet');
    router.refresh();
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
          <span>
            Adding <span className="tabular-nums">{formatMoney(item.amount)}</span> — waiting for EduPay to confirm.
          </span>
          <Button size="sm" variant="outline" disabled={checking !== null} onClick={() => check(item.id)}>
            {checking === item.id && <Loader2 className="size-3.5 animate-spin" />}
            Check now
          </Button>
        </li>
      ))}
    </ul>
  );
}
