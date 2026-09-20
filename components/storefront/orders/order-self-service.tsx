'use client';

/*
 * What a shopper can do about their own order: cancel it before packing, or
 * ask to send items back within the store's return window.
 *
 * Which buttons appear comes from `order.selfService`, worked out on the
 * server by lib/storefront/orders/policy.ts. The server decides again when a
 * button is pressed, so a page left open past packing or past the window
 * gets a plain "not any more" rather than a cancellation that shouldn't be.
 *
 * A guest looking an order up can't act from here — a reference and an email
 * are enough to read an order, not to change one — so they're told how: sign
 * in, or create an account with the email they ordered with.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCcw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialogRoot,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { DialogRoot, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { NoteField, SelectField } from '@/components/storefront/checkout/checkout-fields';
import { cancelMyOrderAction, requestReturnAction } from '@/features/shop-orders/aftercare';
import { RETURN_REASONS } from '@/lib/storefront/orders/policy';
import { formatDate, formatMoney } from '@/lib/storefront/format';
import type { StorefrontOrder } from '@/lib/storefront/orders/types';

const SECONDARY =
  'inline-flex h-11 items-center justify-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-semibold transition-colors hover:bg-secondary disabled:opacity-60';
const PRIMARY =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover disabled:opacity-70';

export function OrderSelfService({
  order,
  mode,
  locale,
}: {
  order: StorefrontOrder;
  /** 'guest': read-only lookup — explain how to act instead of offering buttons */
  mode: 'account' | 'guest';
  locale: string;
}) {
  const { canCancel, returns } = order.selfService;
  if (!canCancel && !returns.open && !(returns.reason === 'window-closed' && returns.deadline)) return null;

  if (mode === 'guest') {
    if (!canCancel && !returns.open) return null;
    return (
      <p className="rounded-xl border bg-secondary/40 px-4 py-3 text-sm">
        To {canCancel ? 'cancel this order' : 'return items'},{' '}
        <Link
          href={`/account/sign-in?next=${encodeURIComponent(`/account/orders/${order.reference}`)}`}
          className="font-semibold text-brand underline-offset-2 hover:underline"
        >
          sign in
        </Link>{' '}
        — or create an account with {order.contact.email} and the order will be there.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {canCancel && <CancelOrderButton order={order} />}
        {returns.open && <ReturnItemsButton order={order} remaining={returns.remaining} />}
      </div>
      {canCancel && (
        <p className="text-xs text-muted-foreground">You can cancel until the store starts packing your order.</p>
      )}
      {returns.open && (
        <p className="text-xs text-muted-foreground">
          You can ask to return items until {formatDate(returns.deadline, locale)}.
        </p>
      )}
      {!returns.open && returns.reason === 'window-closed' && returns.deadline && (
        <p className="text-xs text-muted-foreground">
          The time to ask for a return ended on {formatDate(returns.deadline, locale)}.
        </p>
      )}
    </div>
  );
}

/* ---------------- cancel ---------------- */

function CancelOrderButton({ order }: { order: StorefrontOrder }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const paid = order.paymentStatus === 'PAID';

  const confirm = async () => {
    setPending(true);
    const result = await cancelMyOrderAction({ reference: order.reference, note });
    setPending(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setOpen(false);
    toast.success('Your order is cancelled');
    router.refresh();
  };

  return (
    <AlertDialogRoot open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <button type="button" className={SECONDARY}>
          <XCircle className="size-4" aria-hidden />
          Cancel order
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
          <AlertDialogDescription>
            The items go back on sale and the store stops preparing your order. This can’t be undone.
            {paid &&
              ` You’ve paid ${formatMoney(order.totals.total, order.currency)}, so the store will owe you that back — we’ll email you when they’ve sent it.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <NoteField
          id="cancel-note"
          label="Tell the store why"
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep my order</AlertDialogCancel>
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            aria-busy={pending}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-destructive px-5 text-sm font-semibold text-white transition-colors hover:bg-destructive/90 disabled:opacity-70"
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Cancel order
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogRoot>
  );
}

/* ---------------- return ---------------- */

const REASON_OPTIONS = Object.entries(RETURN_REASONS).map(([value, label]) => ({ value, label }));

function ReturnItemsButton({ order, remaining }: { order: StorefrontOrder; remaining: Record<string, number> }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const returnable = order.lines.filter((line) => (remaining[line.id] ?? 0) > 0);

  const [quantities, setQuantities] = React.useState<Record<string, number>>({});
  const [reason, setReason] = React.useState('');
  const [details, setDetails] = React.useState('');
  const [errors, setErrors] = React.useState<{ lines?: string; reason?: string; details?: string; form?: string }>({});
  const [pending, setPending] = React.useState(false);

  /* One item, one of it: preselect it — there's nothing else to choose. */
  const openForm = () => {
    if (returnable.length === 1 && remaining[returnable[0].id] === 1) setQuantities({ [returnable[0].id]: 1 });
    setErrors({});
    setOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const lines = Object.entries(quantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([orderLineItemId, quantity]) => ({ orderLineItemId, quantity }));

    const next: typeof errors = {};
    if (lines.length === 0) next.lines = 'Choose at least one item to send back.';
    if (!reason) next.reason = 'Choose why you’re sending it back.';
    if (reason === 'other' && !details.trim()) next.details = 'Tell the store a little about why.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setPending(true);
    const result = await requestReturnAction({ reference: order.reference, lines, reason, details });
    setPending(false);
    if (!result.ok) {
      setErrors({ form: result.message });
      return;
    }
    setOpen(false);
    setQuantities({});
    setReason('');
    setDetails('');
    toast.success('Return request sent — we’ll email you when the store replies');
    router.refresh();
  };

  return (
    <DialogRoot open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <button type="button" className={SECONDARY} onClick={openForm}>
        <RotateCcw className="size-4" aria-hidden />
        Return items
      </button>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} noValidate className="space-y-5">
          <div>
            <DialogTitle className="font-display text-lg">Return items</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              Choose what you’d like to send back. The store will reply with how to return it — please hold on to it
              until then.
            </DialogDescription>
          </div>

          {errors.form && (
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
              {errors.form}
            </p>
          )}

          <fieldset aria-describedby={errors.lines ? 'return-lines-error' : undefined}>
            <legend className="text-[0.8125rem] font-semibold">What are you sending back?</legend>
            <ul className="mt-2 divide-y rounded-xl border">
              {returnable.map((line) => {
                const max = remaining[line.id] ?? 0;
                const id = `return-qty-${line.id}`;
                return (
                  <li key={line.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <label htmlFor={id} className="min-w-0 text-sm">
                      <span className="block truncate font-medium">{line.name}</span>
                      {line.variantName && (
                        <span className="block truncate text-xs text-muted-foreground">{line.variantName}</span>
                      )}
                    </label>
                    <select
                      id={id}
                      value={quantities[line.id] ?? 0}
                      onChange={(event) => setQuantities((q) => ({ ...q, [line.id]: Number(event.target.value) }))}
                      className="h-11 w-20 shrink-0 rounded-xl border bg-background px-3 text-base tabular-nums focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {Array.from({ length: max + 1 }, (_, n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
            {errors.lines && (
              <p id="return-lines-error" className="mt-1.5 text-sm text-destructive">
                {errors.lines}
              </p>
            )}
          </fieldset>

          <SelectField
            id="return-reason"
            label="Why are you sending it back?"
            placeholder="Choose a reason"
            options={REASON_OPTIONS}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={errors.reason}
            required
          />

          <NoteField
            id="return-details"
            label="Anything the store should know"
            hint="For example, what’s wrong with it."
            value={details}
            maxLength={1000}
            onChange={(event) => setDetails(event.target.value)}
            error={errors.details}
          />

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Send return request
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="h-12 rounded-full px-5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Not now
            </button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
