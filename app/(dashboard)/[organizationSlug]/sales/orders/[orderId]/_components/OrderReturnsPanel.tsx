'use client';

/*
 * The customer's return requests on this order, and every refund recorded
 * against it.
 *
 * Each open request offers what makes sense now: approve it (saying how to
 * send it back), decline it (saying why — the customer reads this), or record
 * the refund. Declining goes through an AlertDialog because the customer is
 * emailed at once and it can't be taken back.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { formatDate, formatMoney } from '@/lib/format';
import { ORDER_RETURN_LABEL, ORDER_RETURN_VARIANT, returnNextStep } from '@/lib/sales/order-labels';
import { approveOrderReturn, rejectOrderReturn } from '@/features/sales/order-returns';
import type { StoreOrderDetail, StoreOrderReturn } from '@/features/sales/orders';
import { RefundDialog } from './RefundDialog';

type Dialog =
  | { kind: 'approve'; ret: StoreOrderReturn }
  | { kind: 'reject'; ret: StoreOrderReturn }
  | { kind: 'refund'; ret: StoreOrderReturn }
  | null;

export function OrderReturnsPanel({ order, canManage }: { order: StoreOrderDetail; canManage: boolean }) {
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const close = () => setDialog(null);

  if (order.returns.length === 0 && order.refunds.length === 0) return null;

  const returnsById = new Map(order.returns.map((r, index) => [r.id, order.returns.length - index]));

  return (
    <>
      {order.returns.length > 0 && (
        <section id="returns" className="mt-4 rounded-lg border bg-card">
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Return requests</h2>
          <ul className="divide-y">
            {order.returns.map((ret) => {
              const open = ret.status === 'REQUESTED' || ret.status === 'APPROVED';
              const hint = returnNextStep(ret.status);
              return (
                <li key={ret.id} className="space-y-3 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={ORDER_RETURN_VARIANT[ret.status] ?? 'draft'}>
                      {ORDER_RETURN_LABEL[ret.status] ?? '—'}
                    </Badge>
                    <span className="text-sm font-medium">{ret.reasonLabel}</span>
                    <span className="text-xs text-muted-foreground">Requested {formatDate(ret.requestedAt)}</span>
                  </div>

                  <ul className="space-y-1 text-sm">
                    {ret.lines.map((line) => (
                      <li key={line.id} className="flex justify-between gap-4">
                        <span>
                          {line.name}
                          {line.variantName && <span className="text-muted-foreground"> · {line.variantName}</span>}
                          <span className="text-muted-foreground tabular-nums"> × {line.quantity}</span>
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatMoney(line.unitPrice * line.quantity, order.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {ret.details && (
                    <p className="border-l-2 pl-3 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Customer: </span>
                      {ret.details}
                    </p>
                  )}
                  {ret.merchantNote && (
                    <p className="border-l-2 pl-3 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">You told them: </span>
                      <span className="whitespace-pre-line">{ret.merchantNote}</span>
                    </p>
                  )}
                  {ret.status === 'REFUNDED' && (
                    <p className="text-xs text-muted-foreground">
                      Refunded {formatDate(ret.refundedAt)}
                      {ret.restocked ? ' · items put back in stock' : ' · not restocked'}
                    </p>
                  )}
                  {ret.status === 'REJECTED' && (
                    <p className="text-xs text-muted-foreground">Declined {formatDate(ret.rejectedAt)}</p>
                  )}
                  {ret.status === 'WITHDRAWN' && (
                    <p className="text-xs text-muted-foreground">
                      The customer withdrew this request {formatDate(ret.withdrawnAt)}.
                    </p>
                  )}

                  {open && hint && <p className="text-sm text-muted-foreground">{hint}</p>}

                  {canManage && open && (
                    <div className="flex flex-wrap gap-2">
                      {ret.status === 'REQUESTED' && (
                        <Button size="sm" onClick={() => setDialog({ kind: 'approve', ret })}>
                          Approve return
                        </Button>
                      )}
                      {order.refundable > 0 && (
                        <Button
                          size="sm"
                          variant={ret.status === 'APPROVED' ? 'default' : 'outline'}
                          onClick={() => setDialog({ kind: 'refund', ret })}
                        >
                          Record refund
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'reject', ret })}>
                        Decline
                      </Button>
                    </div>
                  )}
                  {canManage && open && order.refundable <= 0 && order.paymentStatus === 'DUE_ON_DELIVERY' && (
                    <p className="text-xs text-muted-foreground">
                      Record the customer’s payment on this order before refunding it.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {order.refunds.length > 0 && (
        <section className="mt-4 rounded-lg border bg-card">
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Refunds</h2>
          <ul className="divide-y text-sm">
            {order.refunds.map((refund) => (
              <li key={refund.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                <span>
                  {refund.returnId
                    ? `For return ${returnsById.get(refund.returnId) ?? ''}`.trim()
                    : 'For the cancelled order'}
                  <span className="text-muted-foreground"> · {formatDate(refund.createdAt)}</span>
                  {refund.note && <span className="block text-xs text-muted-foreground">{refund.note}</span>}
                </span>
                <span className="font-medium tabular-nums">{formatMoney(refund.amount, order.currency)}</span>
              </li>
            ))}
            <li className="flex justify-between px-4 py-3 font-semibold">
              <span>Refunded in total</span>
              <span className="tabular-nums">{formatMoney(order.refundedTotal, order.currency)}</span>
            </li>
          </ul>
        </section>
      )}

      {dialog?.kind === 'approve' && <ApproveDialog ret={dialog.ret} onClose={close} />}
      {dialog?.kind === 'reject' && <RejectDialog ret={dialog.ret} onClose={close} />}
      {dialog?.kind === 'refund' && (
        <RefundDialog
          open
          onOpenChange={(next) => !next && close()}
          target={{ kind: 'return', returnId: dialog.ret.id, canRestock: dialog.ret.canRestock }}
          suggested={dialog.ret.suggestedRefund}
          max={order.refundable}
          currency={order.currency}
          paymentMethod={order.paymentMethod}
        />
      )}
    </>
  );
}

function ApproveDialog({ ret, onClose }: { ret: StoreOrderReturn; onClose: () => void }) {
  const router = useRouter();
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await approveOrderReturn(ret.id, note);
    setPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success('Return approved — the customer has been emailed');
    onClose();
    router.refresh();
  }

  return (
    <DialogRoot open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Approve return</DialogTitle>
            <DialogDescription>
              The customer is emailed that you’ll take the items back. Record the refund once you’ve sent the money.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            {error && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <Field>
              <Label htmlFor="approve-note">How should they send it back?</Label>
              <Textarea
                id="approve-note"
                rows={4}
                maxLength={1000}
                autoFocus
                placeholder="e.g. Drop it at our Lekki shop, or send it by GIG Logistics to 12 Aba Road, Port Harcourt. Write your order number on the parcel."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <FieldDescription>The customer sees this in their email and on their order page.</FieldDescription>
            </Field>
          </div>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Approve return
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

function RejectDialog({ ret, onClose }: { ret: StoreOrderReturn; onClose: () => void }) {
  const router = useRouter();
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<{ note?: string; form?: string }>({});
  const [pending, setPending] = React.useState(false);

  async function confirm() {
    if (!note.trim()) {
      setError({ note: 'Tell the customer why — they’ll see this.' });
      return;
    }
    setPending(true);
    const result = await rejectOrderReturn(ret.id, note);
    setPending(false);
    if (!result.success) {
      setError({ form: result.error });
      return;
    }
    toast.success('Return declined — the customer has been emailed');
    onClose();
    router.refresh();
  }

  return (
    <AlertDialogRoot open onOpenChange={(next) => !next && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Decline this return?</AlertDialogTitle>
          <AlertDialogDescription>
            The customer is emailed straight away with your reason, and can’t ask to return these items again. This
            can’t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error.form && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error.form}
          </p>
        )}
        <Field>
          <Label htmlFor="reject-note">Reason *</Label>
          <Textarea
            id="reject-note"
            rows={3}
            maxLength={1000}
            autoFocus
            placeholder="e.g. The item has been worn, so we can’t resell it."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={error.note ? true : undefined}
          />
          {error.note && <FieldError>{error.note}</FieldError>}
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep request</AlertDialogCancel>
          <Button variant="destructive" size="sm" onClick={() => void confirm()} disabled={pending}>
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Decline return
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogRoot>
  );
}
