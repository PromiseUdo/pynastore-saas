'use client';

/*
 * A counter sale brought back to the shop (ROADMAP 14.7): which items, why,
 * what money was handed back and how, and whether they go back on the
 * shelf. Recorded in one go — the customer is standing there, so there's no
 * request to approve. A Sheet, not a Dialog: it has line items (AGENTS §4).
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Minus, Plus, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SwitchRoot } from '@/components/ui/switch';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  SheetRoot,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { formatMoney } from '@/lib/format';
import {
  COUNTER_REFUND_METHODS,
  COUNTER_RETURN_REASONS,
  isCounterRefundMethod,
  suggestedReturnRefund,
  type CounterRefundMethod,
  type ReturnReason,
} from '@/lib/storefront/orders/policy';
import { recordCounterReturnAction } from '@/features/sales/order-returns';

export interface CounterReturnLine {
  id: string;
  name: string;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  returnable: number;
}

type Errors = Partial<Record<'form' | 'lines' | 'reason' | 'details' | 'amount' | 'method', string>>;

export function CounterReturnButton(props: {
  orderId: string;
  lines: CounterReturnLine[];
  subtotal: number;
  discount: number;
  /** what's still refundable on the sale — 0 when nothing was paid */
  refundable: number;
  paymentStatus: string;
  paymentMethod: string;
  currency: string;
  storeName: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  if (!props.lines.some((line) => line.returnable > 0)) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Undo2 className="size-3.5" />
        Return items
      </Button>
      {open && <CounterReturnSheet {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function CounterReturnSheet({
  orderId,
  lines,
  subtotal,
  discount,
  refundable,
  paymentStatus,
  paymentMethod,
  currency,
  storeName,
  onClose,
}: React.ComponentProps<typeof CounterReturnButton> & { onClose: () => void }) {
  const router = useRouter();
  const open = lines.filter((line) => line.returnable > 0);
  const [quantities, setQuantities] = React.useState<Record<string, number>>(() =>
    // One line of one unit is almost always "this one": start there.
    open.length === 1 && open[0].returnable === 1 ? { [open[0].id]: 1 } : {},
  );
  const [reason, setReason] = React.useState<ReturnReason | ''>('');
  const [details, setDetails] = React.useState('');
  const [restock, setRestock] = React.useState(true);
  const [amount, setAmount] = React.useState('');
  const [amountTouched, setAmountTouched] = React.useState(false);
  const [method, setMethod] = React.useState<CounterRefundMethod>(isCounterRefundMethod(paymentMethod) ? paymentMethod : 'cash');
  const [refundNote, setRefundNote] = React.useState('');
  const [errors, setErrors] = React.useState<Errors>({});
  const [pending, setPending] = React.useState(false);

  const canRefund = refundable > 0;
  const chosen = open.filter((line) => (quantities[line.id] ?? 0) > 0);
  const units = chosen.reduce((sum, line) => sum + (quantities[line.id] ?? 0), 0);
  const suggested = Math.min(
    refundable,
    suggestedReturnRefund({
      subtotal,
      discount,
      lines: chosen.map((line) => ({ unitPrice: line.unitPrice, quantity: quantities[line.id] ?? 0 })),
    }),
  );
  // Follow the items until the staff member types their own figure.
  const amountShown = !canRefund ? '0' : amountTouched ? amount : suggested ? String(suggested) : '';
  const amountValue = Number(amountShown.replace(/,/g, '') || '0');

  function setQuantity(line: CounterReturnLine, next: number) {
    setQuantities((current) => ({ ...current, [line.id]: Math.max(0, Math.min(line.returnable, next)) }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: Errors = {};
    if (units === 0) next.lines = 'Choose at least one item that came back.';
    if (!reason) next.reason = 'Choose why it’s coming back.';
    if (reason === 'other' && !details.trim()) next.details = 'Add a short note about why.';
    if (!Number.isFinite(amountValue) || amountValue < 0) next.amount = 'Enter the amount given back, or 0 for none.';
    else if (amountValue > refundable) next.amount = `At most ${formatMoney(refundable, currency)} can be given back on this sale.`;
    setErrors(next);
    if (Object.keys(next).length) return;

    setPending(true);
    const result = await recordCounterReturnAction(orderId, {
      lines: chosen.map((line) => ({ orderLineItemId: line.id, quantity: quantities[line.id] ?? 0 })),
      reason: reason as ReturnReason,
      details: details.trim() || undefined,
      refundAmount: amountValue,
      refundMethod: amountValue > 0 ? method : undefined,
      refundNote: refundNote.trim() || undefined,
      restock,
    });
    setPending(false);
    if (!result.success) {
      setErrors({ form: result.error });
      return;
    }
    toast.success(
      [
        `Return recorded: ${units} item${units === 1 ? '' : 's'}`,
        amountValue > 0 ? `${formatMoney(amountValue, currency)} given back` : 'nothing refunded',
        restock ? 'back in stock' : null,
      ]
        .filter(Boolean)
        .join(', '),
    );
    onClose();
    router.refresh();
  }

  return (
    <SheetRoot open onOpenChange={(next) => !next && !pending && onClose()}>
      <SheetContent>
        <form onSubmit={submit} noValidate className="flex h-full flex-col">
          <SheetHeader>
            <SheetTitle>Return items</SheetTitle>
            <SheetDescription>
              For a customer bringing back something they bought in the shop. It’s recorded straight away — there’s nothing to
              approve.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
            {errors.form && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {errors.form}
              </p>
            )}

            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">What came back *</legend>
              <ul className="divide-y rounded-md border">
                {open.map((line) => {
                  const qty = quantities[line.id] ?? 0;
                  return (
                    <li key={line.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0 text-sm">
                        <p className="font-medium">
                          {line.name}
                          {line.variantName && <span className="font-normal text-muted-foreground"> · {line.variantName}</span>}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {formatMoney(line.unitPrice, currency)} each ·{' '}
                          {line.returnable === line.quantity
                            ? `${line.quantity} sold`
                            : `${line.returnable} of ${line.quantity} can still come back`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="size-8"
                          aria-label={`One fewer ${line.name}`}
                          disabled={qty === 0}
                          onClick={() => setQuantity(line, qty - 1)}
                        >
                          <Minus className="size-3.5" />
                        </Button>
                        <Input
                          aria-label={`How many ${line.name} came back`}
                          inputMode="numeric"
                          value={String(qty)}
                          onChange={(e) => setQuantity(line, Number(e.target.value.replace(/\D/g, '') || '0'))}
                          className="h-8 w-12 text-center tabular-nums"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="size-8"
                          aria-label={`One more ${line.name}`}
                          disabled={qty >= line.returnable}
                          onClick={() => setQuantity(line, qty + 1)}
                        >
                          <Plus className="size-3.5" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {errors.lines && <FieldError>{errors.lines}</FieldError>}
            </fieldset>

            <Field>
              <Label htmlFor="counter-return-reason">Why *</Label>
              <SelectRoot value={reason} onValueChange={(value) => setReason(value as ReturnReason)}>
                <SelectTrigger id="counter-return-reason" aria-invalid={errors.reason ? true : undefined}>
                  <SelectValue placeholder="Choose a reason" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(COUNTER_RETURN_REASONS) as ReturnReason[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {COUNTER_RETURN_REASONS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </SelectRoot>
              {errors.reason && <FieldError>{errors.reason}</FieldError>}
            </Field>

            <Field>
              <Label htmlFor="counter-return-details">Note{reason === 'other' ? ' *' : ''}</Label>
              <Textarea
                id="counter-return-details"
                rows={2}
                maxLength={1000}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                aria-invalid={errors.details ? true : undefined}
                placeholder="e.g. Strap broke after two days"
              />
              {errors.details ? <FieldError>{errors.details}</FieldError> : <FieldDescription>Only your team sees this.</FieldDescription>}
            </Field>

            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div>
                <Label htmlFor="counter-return-restock">Put the items back in stock</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Adds them back to {storeName ?? 'the store that sold them'}. Turn off if they’re damaged and can’t be sold again.
                </p>
              </div>
              <SwitchRoot id="counter-return-restock" checked={restock} onCheckedChange={setRestock} />
            </div>

            <fieldset className="space-y-4 rounded-md border p-3">
              <legend className="px-1 text-sm font-semibold">Money given back</legend>
              {!canRefund ? (
                <p className="text-sm text-muted-foreground">
                  {paymentStatus === 'REFUNDED'
                    ? 'Everything paid for this sale has already been given back, so this return gives back nothing more.'
                    : 'This sale hasn’t been paid, so there’s no money to give back. The return is recorded with nothing refunded.'}
                </p>
              ) : (
                <>
                  <Field>
                    <Label htmlFor="counter-return-amount">Amount given back *</Label>
                    <Input
                      id="counter-return-amount"
                      inputMode="decimal"
                      value={amountShown}
                      onChange={(e) => {
                        setAmountTouched(true);
                        setAmount(e.target.value);
                      }}
                      aria-invalid={errors.amount ? true : undefined}
                      className="tabular-nums"
                    />
                    {errors.amount ? (
                      <FieldError>{errors.amount}</FieldError>
                    ) : (
                      <FieldDescription>
                        {units > 0
                          ? `The items come to ${formatMoney(suggested, currency)} after the sale’s discount. `
                          : ''}
                        Enter 0 for an exchange or store credit. Up to {formatMoney(refundable, currency)}.
                      </FieldDescription>
                    )}
                  </Field>

                  {amountValue > 0 && (
                    <>
                      <Field>
                        <Label htmlFor="counter-return-method">How it was given back *</Label>
                        <SelectRoot value={method} onValueChange={(value) => setMethod(value as CounterRefundMethod)}>
                          <SelectTrigger id="counter-return-method">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(COUNTER_REFUND_METHODS) as CounterRefundMethod[]).map((key) => (
                              <SelectItem key={key} value={key}>
                                {COUNTER_REFUND_METHODS[key]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </SelectRoot>
                        <FieldDescription>The app doesn’t move the money — record what you handed back.</FieldDescription>
                      </Field>
                      <Field>
                        <Label htmlFor="counter-return-refund-note">Refund note</Label>
                        <Input
                          id="counter-return-refund-note"
                          maxLength={400}
                          value={refundNote}
                          onChange={(e) => setRefundNote(e.target.value)}
                          placeholder="e.g. Transfer to Ada’s GTB account"
                        />
                      </Field>
                    </>
                  )}
                </>
              )}
            </fieldset>
          </div>

          <SheetFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Record return
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </SheetRoot>
  );
}
