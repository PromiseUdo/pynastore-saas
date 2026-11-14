'use client';

/*
 * "Delivery to be arranged" (ROADMAP 21.4B) on the order page: the one thing
 * this order needs from the store — a delivery price, by its deadline.
 *
 * Once set, the customer sees it with the new total and accepts it before
 * paying; until they do, the price can be changed (they're told again). The
 * server decides all of it (lib/storefront/orders/arranged.ts); this shows
 * where it stands and asks.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
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
import { setArrangedDeliveryPrice, type StoreOrderDetail } from '@/features/sales/orders';
import { formatDateTime, formatMoney } from '@/lib/format';

export function ArrangedDeliveryPanel({ order, canManage }: { order: StoreOrderDetail; canManage: boolean }) {
  const arranged = order.arranged;
  if (!arranged) return null;
  const waiting = order.status === 'PENDING' && order.paymentStatus === 'AWAITING_DELIVERY_PRICE' && !arranged.acceptedAt;
  const fee = order.deliveryFee;

  return (
    <section aria-labelledby="arranged-heading" className="mt-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Truck className="size-4 text-muted-foreground" aria-hidden />
            <h2 id="arranged-heading" className="text-sm font-semibold">
              Delivery to be arranged
            </h2>
            {order.status === 'CANCELLED' ? null : arranged.acceptedAt ? (
              <Badge variant="success">Accepted</Badge>
            ) : arranged.pricedAt ? (
              <Badge variant="pending">Waiting for the customer</Badge>
            ) : (
              <Badge variant="warning">Set the price</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.status === 'CANCELLED'
              ? fee !== null
                ? `Delivery was priced at ${formatMoney(fee, order.currency)}, arranged by you.`
                : 'This order was cancelled before delivery was priced.'
              : arranged.acceptedAt
                ? `The customer accepted ${fee === null ? 'the price' : formatMoney(fee, order.currency)} on ${formatDateTime(arranged.acceptedAt)}. It now goes ahead like any order.`
                : arranged.pricedAt
                  ? `You priced delivery at ${fee === null ? '—' : formatMoney(fee, order.currency)}. The customer has until ${formatDateTime(arranged.acceptBy)} to accept it; then they pay the way they chose. You can still change it.`
                  : `This trade order is too big for a fixed delivery price. Work out what it costs to deliver from ${
                      order.parcels[0]?.storeName ?? 'your store'
                    } and set it by ${formatDateTime(arranged.priceDueAt)} — otherwise the order is cancelled and its stock released. The customer sees the price and accepts it before paying anything.`}
          </p>
          {arranged.note && <p className="mt-1 text-sm">How it’s going: {arranged.note}</p>}
        </div>
        {canManage && waiting && <PriceDialog order={order} />}
      </div>
    </section>
  );
}

function PriceDialog({ order }: { order: StoreOrderDetail }) {
  const router = useRouter();
  const priced = Boolean(order.arranged?.pricedAt);
  const [open, setOpen] = React.useState(false);
  const [fee, setFee] = React.useState(priced && order.deliveryFee !== null ? String(order.deliveryFee) : '');
  const [note, setNote] = React.useState(order.arranged?.note ?? '');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const amount = Number(fee.replace(/,/g, ''));
  const goods = order.totalAmount - (order.deliveryFee ?? 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (fee.trim() === '' || !Number.isFinite(amount) || amount < 0) {
      setError('Enter the delivery cost, in naira. Enter 0 if it’s free.');
      return;
    }
    setPending(true);
    setError(null);
    const result = await setArrangedDeliveryPrice(order.id, { fee: amount, note });
    setPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success(priced ? 'Delivery price changed — the customer has been told' : 'Delivery price sent to the customer');
    setOpen(false);
    router.refresh();
  }

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={priced ? 'outline' : 'default'}>
          {priced ? 'Change price' : 'Set delivery price'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{priced ? 'Change the delivery price' : 'Set the delivery price'}</DialogTitle>
            <DialogDescription>
              For order {order.reference}. The customer is emailed the price and the new total, and accepts it before paying.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <Field>
              <Label htmlFor="arranged-fee">Delivery cost (₦) *</Label>
              <Input
                id="arranged-fee"
                autoFocus
                inputMode="decimal"
                placeholder="e.g. 45000"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                aria-invalid={error ? true : undefined}
              />
              {error ? (
                <FieldError>{error}</FieldError>
              ) : (
                <FieldDescription>
                  {fee.trim() !== '' && Number.isFinite(amount) && amount >= 0
                    ? `New order total: ${formatMoney(goods + amount, order.currency)}.`
                    : 'What you’ll charge to deliver this order. Enter 0 if it’s free.'}
                </FieldDescription>
              )}
            </Field>
            <Field>
              <Label htmlFor="arranged-note">How it’s going</Label>
              <Input
                id="arranged-note"
                placeholder="e.g. Our truck, Thursday"
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <FieldDescription>Optional. The customer sees this beside the price.</FieldDescription>
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
              {priced ? 'Change price' : 'Send price to customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
