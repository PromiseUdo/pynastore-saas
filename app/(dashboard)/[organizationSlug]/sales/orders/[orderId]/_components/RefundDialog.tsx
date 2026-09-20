'use client';

/*
 * "Record refund" — the merchant telling the app they've sent money back.
 *
 * The app moves no money, so this is a record made AFTER the refund, and the
 * dialog says so. The amount starts at the most useful figure (everything
 * still owed on a cancelled order; the returned lines' value on a return) and
 * can be changed — a merchant keeping the delivery fee, or adding it back, is
 * their call. Three fields and a switch, so a dialog.
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
import { refundCancelledStoreOrder, refundOrderReturn } from '@/features/sales/order-returns';

const HOW_TO_REFUND: Record<string, string> = {
  squad: 'The customer paid online, so refund them from your Squad dashboard first.',
  transfer: 'The customer paid by bank transfer, so send the money back from your bank first.',
  pod: 'The customer paid the courier, so pay them back the way you agree with them first.',
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: Target;
  /** major units */
  suggested: number;
  /** major units: what hasn't been refunded yet */
  max: number;
  currency: string;
  /** how the customer paid: 'squad' | 'transfer' | 'pod' */
  paymentMethod: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = React.useState(String(Math.min(suggested, max)));
  const [note, setNote] = React.useState('');
  const [restock, setRestock] = React.useState(target.kind === 'return' && target.canRestock);
  const [error, setError] = React.useState<{ amount?: string; form?: string }>({});
  const [pending, setPending] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount.replace(/,/g, ''));
    if (!amount.trim() || !Number.isFinite(value) || value <= 0) {
      setError({ amount: 'Enter the amount you sent back.' });
      return;
    }
    if (value > max + 0.001) {
      setError({ amount: `That’s more than is left to refund (${formatMoney(max, currency)}).` });
      return;
    }

    setPending(true);
    setError({});
    const result =
      target.kind === 'order'
        ? await refundCancelledStoreOrder(target.orderId, { amount: value, note })
        : await refundOrderReturn(target.returnId, { amount: value, note, restock });
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
            <DialogTitle>Record refund</DialogTitle>
            <DialogDescription>
              {HOW_TO_REFUND[paymentMethod] ?? HOW_TO_REFUND.default} Then record it here — the app doesn’t move the
              money itself. The customer is emailed that you’ve sent it.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error.form && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error.form}
              </p>
            )}

            <Field>
              <Label htmlFor="refund-amount">Amount sent back *</Label>
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
                    ? `The returned items come to ${formatMoney(suggested, currency)} after any discount. Delivery isn’t included.`
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
                placeholder="e.g. Refunded in Squad on 18 Sep"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <FieldDescription>Only your team sees this.</FieldDescription>
            </Field>

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
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Record refund
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
}: {
  orderId: string;
  /** major units */
  refundable: number;
  currency: string;
  paymentMethod: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Record refund
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
        />
      )}
    </>
  );
}
