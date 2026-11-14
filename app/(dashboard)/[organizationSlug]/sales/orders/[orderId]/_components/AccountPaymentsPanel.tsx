'use client';

/*
 * Pay on account (ROADMAP 21.5) on the order page: when it's due, what the
 * customer has paid so far, what's left — and "Record payment" for money
 * that arrived in the merchant's own bank or hand. Part payments are fine;
 * the one that covers the total makes the order paid. The rules are the
 * server's (lib/storefront/orders/account.ts).
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  DialogRoot,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { recordOrderAccountPayment, type StoreOrderDetail } from '@/features/sales/orders';
import { formatDate, formatMoney } from '@/lib/format';

const METHODS: Record<string, string> = { transfer: 'Bank transfer', cash: 'Cash', cheque: 'Cheque', other: 'Other' };

export function AccountPaymentsPanel({ order, canManage }: { order: StoreOrderDetail; canManage: boolean }) {
  const account = order.account;
  if (!account) return null;
  const money = (value: number) => formatMoney(value, order.currency);
  const owing = order.paymentStatus === 'ON_ACCOUNT' && order.status !== 'CANCELLED';

  return (
    <section aria-labelledby="account-heading" className="mt-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Wallet className="size-4 text-muted-foreground" aria-hidden />
            <h2 id="account-heading" className="text-sm font-semibold">
              On account
            </h2>
            {order.paymentStatus === 'PAID' ? (
              <Badge variant="success">Paid</Badge>
            ) : account.overdue ? (
              <Badge variant="overdue">Overdue</Badge>
            ) : owing ? (
              <Badge variant="info">{account.dueAt ? `Due ${formatDate(account.dueAt)}` : 'On account'}</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.paymentStatus === 'PAID'
              ? 'Paid in full.'
              : order.status === 'CANCELLED'
                ? 'This order was cancelled.'
                : `The customer pays you directly by ${account.dueAt ? formatDate(account.dueAt) : 'the due date'}. Record each payment here when it arrives — they’re reminded before and after the due date until it’s paid.`}
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm sm:max-w-md">
            <div>
              <dt className="text-xs text-muted-foreground">Total</dt>
              <dd className="tabular-nums">{money(order.totalAmount)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Paid</dt>
              <dd className="tabular-nums">{money(account.paid)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Still to pay</dt>
              <dd className="font-medium tabular-nums">{money(account.outstanding)}</dd>
            </div>
          </dl>
          {account.payments.length > 0 && (
            <ul className="mt-3 space-y-1 border-t pt-3 text-sm">
              {account.payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap justify-between gap-x-4">
                  <span className="text-muted-foreground">
                    {formatDate(payment.receivedAt)} · {METHODS[payment.method] ?? 'Other'}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                  </span>
                  <span className="tabular-nums">{money(payment.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {canManage && owing && account.outstanding > 0 && <RecordDialog order={order} outstanding={account.outstanding} />}
      </div>
    </section>
  );
}

function today(): string {
  // The Lagos date, for the date field's default.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
}

function RecordDialog({ order, outstanding }: { order: StoreOrderDetail; outstanding: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState(String(outstanding));
  const [method, setMethod] = React.useState('transfer');
  const [date, setDate] = React.useState(today());
  const [reference, setReference] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount.replace(/,/g, ''));
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter the amount they paid.');
      return;
    }
    setPending(true);
    setError(null);
    // Noon Lagos time on the day chosen, so the date never slips a day either way.
    const result = await recordOrderAccountPayment(order.id, {
      amount: value,
      method,
      reference,
      receivedAt: date ? `${date}T11:00:00.000Z` : null,
    });
    setPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success(result.data.paid ? 'Payment recorded — the order is paid' : 'Payment recorded');
    setOpen(false);
    router.refresh();
  }

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Record payment</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>
              Money the customer paid you towards order {order.reference}. {formatMoney(outstanding, order.currency)} is still to pay.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <Field>
              <Label htmlFor="account-amount">Amount (₦) *</Label>
              <Input
                id="account-amount"
                autoFocus
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={error ? true : undefined}
              />
              {error ? <FieldError>{error}</FieldError> : <FieldDescription>Part payments are fine.</FieldDescription>}
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <Label htmlFor="account-method">How they paid *</Label>
                <SelectRoot value={method} onValueChange={setMethod}>
                  <SelectTrigger id="account-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(METHODS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
              </Field>
              <Field>
                <Label htmlFor="account-date">Date it arrived *</Label>
                <Input id="account-date" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            <Field>
              <Label htmlFor="account-reference">Reference</Label>
              <Input
                id="account-reference"
                placeholder="e.g. their bank’s reference"
                maxLength={80}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
              <FieldDescription>Optional — anything that helps you find it in your bank statement.</FieldDescription>
            </Field>
          </div>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
