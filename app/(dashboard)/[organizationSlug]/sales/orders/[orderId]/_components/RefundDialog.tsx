'use client';

/*
 * "Record refund" — the merchant telling the app they've sent money back.
 *
 * The app moves no money, so this is a record made AFTER the refund, and the
 * dialog says so. The amount starts at the most useful figure (everything
 * still owed on a cancelled order; the returned lines' value on a return) and
 * can be changed — a merchant keeping the delivery fee, or adding it back, is
 * their call. Three fields and a switch, so a dialog.
 *
 * WALLET ORDERS (ROADMAP 20.6). For an order the customer paid from their
 * EduPay wallet, the app DOES send the money: from the shop wallet back to
 * theirs, with the shop wallet's PIN (`wallet`), and records it once EduPay
 * confirms. Same dialog, plus the balance and a PIN field.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SwitchRoot } from '@/components/ui/switch';
import { CheckboxRoot } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { formatMoney } from '@/lib/format';
import { refundCancelledStoreOrder, refundOrderReturn, sendWalletRefundAction } from '@/features/sales/order-returns';
import type { WalletRefundOption } from '@/lib/storefront/orders/wallet-refunds';

const HOW_TO_REFUND: Record<string, string> = {
  paystack: 'The customer paid online and the money was paid into your bank account, so send it back from there first.',
  squad: 'The customer paid online through our old payment provider — send the money back from your bank first.',
  transfer: 'The customer paid by bank transfer, so send the money back from your bank first.',
  pod: 'The customer paid the courier, so pay them back the way you agree with them first.',
  // Only when their wallet is no longer connected; otherwise the dialog sends it there (`wallet`).
  wallet:
    'The customer paid from their wallet, but it’s no longer connected, so pay them back the way you agree with them first.',
  default: 'Send the money back to the customer first.',
};

type Target =
  | { kind: 'order'; orderId: string }
  | { kind: 'return'; returnId: string; canRestock: boolean };

export function RefundDialog({
  open,
  onOpenChange,
  target,
  suggested,
  max,
  currency,
  paymentMethod,
  deliveryFees = [],
  wallet = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: Target;
  /** major units */
  suggested: number;
  /** major units: what hasn't been refunded yet */
  max: number;
  currency: string;
  /** how the customer paid: 'paystack' | 'wallet' | 'transfer' | 'pod' (or 'squad', on older orders) */
  paymentMethod: string;
  /**
   * Parcels' delivery fees the merchant may add back (ROADMAP Phase 9.6) —
   * e.g. the parcel whose items all came back. Major units.
   */
  deliveryFees?: { id: string; label: string; amount: number }[];
  /** paid from the customer's wallet: send it back there from the shop wallet (20.6) */
  wallet?: WalletRefundOption | null;
}) {
  const router = useRouter();
  const [amount, setAmount] = React.useState(String(Math.min(suggested, max)));
  const [addedFees, setAddedFees] = React.useState<string[]>([]);

  /* Ticking a parcel's delivery adds it to whatever is in the box (and
   * untick takes it off), so a figure the merchant typed is kept. */
  function toggleFee(fee: { id: string; amount: number }, on: boolean) {
    setAddedFees((current) => (on ? [...current, fee.id] : current.filter((id) => id !== fee.id)));
    const base = Number(amount.replace(/,/g, '')) || 0;
    setAmount(String(Math.round((base + (on ? fee.amount : -fee.amount)) * 100) / 100));
  }
  const [note, setNote] = React.useState('');
  const [restock, setRestock] = React.useState(target.kind === 'return' && target.canRestock);
  const [error, setError] = React.useState<{ amount?: string; pin?: string; form?: string }>({});
  const [pending, setPending] = React.useState(false);
  const [pin, setPin] = React.useState('');
  const toWallet = Boolean(wallet);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount.replace(/,/g, ''));
    if (!amount.trim() || !Number.isFinite(value) || value <= 0) {
      setError({ amount: toWallet ? 'Enter the amount to send back.' : 'Enter the amount you sent back.' });
      return;
    }
    if (value > max + 0.001) {
      setError({ amount: `That’s more than is left to refund (${formatMoney(max, currency)}).` });
      return;
    }
    if (toWallet && !/^\d{4}$/.test(pin)) {
      setError({ pin: 'Enter the shop wallet’s 4-digit PIN.' });
      return;
    }

    setPending(true);
    setError({});
    const fullNote = [
      note.trim(),
      // Which parcels' delivery went back, in the merchant's own records.
      ...(target.kind === 'return' ? deliveryFees.filter((fee) => addedFees.includes(fee.id)).map((fee) => `Includes delivery: ${fee.label}.`) : []),
    ]
      .filter(Boolean)
      .join(' ');

    if (toWallet) {
      const sent = await sendWalletRefundAction(
        target.kind === 'order' ? { kind: 'order', orderId: target.orderId } : { kind: 'return', returnId: target.returnId },
        { amount: value, note: fullNote, restock: target.kind === 'return' && restock, pin },
      );
      setPin('');
      setPending(false);
      if (!sent.success) {
        // A wrong PIN belongs next to the PIN; anything else at the top.
        setError(/^That shop wallet PIN/.test(sent.error) ? { pin: sent.error } : { form: sent.error });
        return;
      }
      if (sent.data.checking) {
        toast.warning('We couldn’t get a clear answer from EduPay. We’re checking whether the refund went — don’t send it again.');
      } else {
        toast.success('Refund sent to the customer’s wallet — they’ve been emailed');
      }
      onOpenChange(false);
      router.refresh();
      return;
    }

    const result =
      target.kind === 'order'
        ? await refundCancelledStoreOrder(target.orderId, { amount: value, note })
        : await refundOrderReturn(target.returnId, { amount: value, note: fullNote, restock });
    setPending(false);

    if (!result.success) {
      setError({ form: result.error });
      return;
    }
    toast.success(
      target.kind === 'return' && restock
        ? 'Refund recorded, items back in stock — the customer has been emailed'
        : 'Refund recorded — the customer has been emailed',
    );
    onOpenChange(false);
    router.refresh();
  }

  return (
    <DialogRoot open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{toWallet ? 'Refund to the customer’s wallet' : 'Record refund'}</DialogTitle>
            <DialogDescription>
              {toWallet ? (
                'The customer paid from their EduPay wallet. This sends the money from your shop wallet straight back to theirs, and emails them once it’s there.'
              ) : (
                <>
                  {HOW_TO_REFUND[paymentMethod] ?? HOW_TO_REFUND.default} Then record it here — the app doesn’t move the
                  money itself. The customer is emailed that you’ve sent it.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error.form && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error.form}
              </p>
            )}

            {wallet?.checking && (
              <p role="status" className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                A refund to this customer’s wallet is still being checked with EduPay. Wait for it to settle before sending
                another — refresh this page in a few minutes.
              </p>
            )}

            {wallet && (
              <p className="flex justify-between gap-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="text-muted-foreground">In your shop wallet</span>
                <span className="tabular-nums">{wallet.shopBalance === null ? '—' : formatMoney(wallet.shopBalance, currency)}</span>
              </p>
            )}

            <Field>
              <Label htmlFor="refund-amount">{toWallet ? 'Amount to send back *' : 'Amount sent back *'}</Label>
              <Input
                id="refund-amount"
                inputMode="decimal"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={error.amount ? true : undefined}
                className="tabular-nums"
              />
              {error.amount ? (
                <FieldError>{error.amount}</FieldError>
              ) : (
                <FieldDescription>
                  {target.kind === 'return'
                    ? `The returned items come to ${formatMoney(suggested, currency)} after any discount. Delivery isn’t included${deliveryFees.length ? ' unless you add it below' : ''}.`
                    : 'Everything the customer paid that hasn’t gone back yet.'}{' '}
                  Up to {formatMoney(max, currency)}.
                </FieldDescription>
              )}
            </Field>

            <Field>
              <Label htmlFor="refund-note">Note for your records</Label>
              <Textarea
                id="refund-note"
                rows={2}
                maxLength={500}
                placeholder="e.g. Sent back by transfer on 18 Sep"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <FieldDescription>Only your team sees this.</FieldDescription>
            </Field>

            {toWallet && (
              <Field>
                <Label htmlFor="refund-pin">Shop wallet PIN *</Label>
                <Input
                  id="refund-pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  aria-invalid={error.pin ? true : undefined}
                  className="w-32 tracking-[0.5em] tabular-nums"
                />
                {error.pin ? (
                  <FieldError>{error.pin}</FieldError>
                ) : (
                  <FieldDescription>The 4-digit PIN of your shop wallet (Settings → Payments → Shop wallet).</FieldDescription>
                )}
              </Field>
            )}

            {target.kind === 'return' && deliveryFees.length > 0 && (
              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">Refund delivery too</legend>
                {deliveryFees.map((fee) => (
                  <label key={fee.id} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <CheckboxRoot
                        checked={addedFees.includes(fee.id)}
                        onCheckedChange={(checked) => toggleFee(fee, checked === true)}
                      />
                      {fee.label}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{formatMoney(fee.amount, currency)}</span>
                  </label>
                ))}
                <p className="text-xs text-muted-foreground">
                  Each parcel was charged its own delivery. Add one back if its items were all returned, or the fault was
                  yours.
                </p>
              </fieldset>
            )}

            {target.kind === 'return' && target.canRestock && (
              <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                <div>
                  <Label htmlFor="refund-restock">Put the items back in stock</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Adds them back to the store they were sent from. Turn off if they’re damaged or you didn’t get
                    them back.
                  </p>
                </div>
                <SwitchRoot id="refund-restock" checked={restock} onCheckedChange={setRestock} />
              </div>
            )}
          </div>

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending || Boolean(wallet?.checking)}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {toWallet ? 'Send refund' : 'Record refund'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

/** The header button for an order cancelled after it was paid. */
export function RecordOrderRefundButton({
  orderId,
  refundable,
  currency,
  paymentMethod,
  wallet = null,
}: {
  orderId: string;
  /** major units */
  refundable: number;
  /** paid from the customer's wallet: send it back there (20.6) */
  wallet?: WalletRefundOption | null;
  currency: string;
  paymentMethod: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {wallet ? 'Refund to wallet' : 'Record refund'}
      </Button>
      {open && (
        <RefundDialog
          open
          onOpenChange={setOpen}
          target={{ kind: 'order', orderId }}
          suggested={refundable}
          max={refundable}
          currency={currency}
          paymentMethod={paymentMethod}
          wallet={wallet}
        />
      )}
    </>
  );
}
