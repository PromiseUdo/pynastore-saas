'use client';

/*
 * The parcels an online order travels in (ROADMAP Phase 9.6), one card each.
 *
 * A bag the storefront split across stores is sent by each store on its own:
 * the card says where the parcel leaves from, what's in it, how it travels,
 * what its trip was charged and — for pay on delivery — what its courier
 * collects. Each store's staff send their own parcel from here; a member who
 * can't work in that store sees it, view-only, with the reason (AGENTS §7).
 * Whether a move is allowed is decided on the server; this only offers it.
 *
 * With one parcel the header's buttons already move the whole order, so the
 * card just shows the parcel and its packing slip.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Printer, Store, Truck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SwitchRoot } from '@/components/ui/switch';
import { Field, FieldDescription } from '@/components/ui/form-field';
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
import { formatEta, formatReady } from '@/lib/storefront/delivery/eta';
import { updateStoreShipment, type StoreOrderParcel } from '@/features/sales/orders';

/** Still waiting on another store to send, or on a transfer on its way (Phase 9.7). */
const waiting = (parcel: StoreOrderParcel) => parcel.broughtFrom.some((t) => t.status === 'REQUESTED' || t.status === 'DISPATCHED');

const STATUS: Record<StoreOrderParcel['status'], { label: string; variant: 'pending' | 'processing' | 'completed' | 'cancelled' }> = {
  PENDING: { label: 'Waiting to be sent', variant: 'pending' },
  DISPATCHED: { label: 'On its way', variant: 'processing' },
  DELIVERED: { label: 'Delivered', variant: 'completed' },
  CANCELLED: { label: 'Cancelled', variant: 'cancelled' },
};

export function ParcelsPanel({
  orderId,
  parcels,
  currency,
  canManage,
  canSend,
  payOnDelivery,
  totalAmount,
}: {
  orderId: string;
  parcels: StoreOrderParcel[];
  currency: string;
  canManage: boolean;
  /** the order is confirmed and paid (or pay on delivery), so parcels may leave */
  canSend: boolean;
  payOnDelivery: boolean;
  /** major units */
  totalAmount: number;
}) {
  const router = useRouter();
  const several = parcels.length > 1;
  const [sending, setSending] = React.useState<StoreOrderParcel | null>(null);
  const [delivering, setDelivering] = React.useState<StoreOrderParcel | null>(null);
  const [trackingNote, setTrackingNote] = React.useState('');
  const [paymentCollected, setPaymentCollected] = React.useState(true);
  const [pending, setPending] = React.useState(false);

  const outstanding = parcels.filter((p) => p.status === 'PENDING' || p.status === 'DISPATCHED').length;

  async function run(parcel: StoreOrderParcel, action: 'send' | 'deliver') {
    setPending(true);
    const result = await updateStoreShipment(orderId, parcel.id, action, {
      trackingNote: action === 'send' ? trackingNote : undefined,
      paymentCollected: action === 'deliver' ? paymentCollected : undefined,
    });
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(
      action === 'send'
        ? `Parcel from ${parcel.storeName ?? 'your store'} sent — its stock is off the shelf`
        : `Parcel from ${parcel.storeName ?? 'your store'} marked delivered`,
    );
    setSending(null);
    setDelivering(null);
    setTrackingNote('');
    router.refresh();
  }

  return (
    <section className="mt-4 rounded-lg border bg-card" aria-labelledby="parcels-heading">
      <div className="border-b px-4 py-3">
        <h2 id="parcels-heading" className="text-sm font-semibold">
          {several ? `Parcels (${parcels.length})` : 'Parcel'}
        </h2>
        {several && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            The customer’s bag comes from more than one store, so each store sends its own parcel and charged its own
            delivery.
          </p>
        )}
      </div>

      <ul className="divide-y">
        {parcels.map((parcel, index) => {
          const status = STATUS[parcel.status];
          const window = parcel.eta ? (parcel.kind === 'PICKUP' ? formatReady(parcel.eta) : formatEta(parcel.eta)) : null;
          return (
            <li key={parcel.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {several ? `Parcel ${index + 1} · ` : ''}
                    {parcel.kind === 'PICKUP' ? 'Collected at ' : 'From '}
                    {parcel.warehouseId && parcel.storeName ? (
                      <Link href={`/inventory/warehouses/${parcel.warehouseId}`} className="hover:underline">
                        {parcel.storeName}
                      </Link>
                    ) : (
                      (parcel.storeName ?? 'a store not recorded')
                    )}
                  </span>
                  <Badge variant={status.variant}>{status.label}</Badge>
                  {!parcel.canWorkHere && <Badge variant="muted">View only</Badge>}
                </div>
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  {parcel.kind === 'PICKUP' ? <Store className="size-3.5" aria-hidden /> : <Truck className="size-3.5" aria-hidden />}
                  {parcel.label} ·{' '}
                  <span className="tabular-nums">{parcel.fee === 0 ? 'Free' : formatMoney(parcel.fee, currency)}</span>
                  {parcel.freeOverApplied && ' (free-delivery threshold met)'}
                  {window && ` · ${window}`}
                </p>
                <p className="text-muted-foreground">
                  {parcel.items.length
                    ? parcel.items
                        .map((item) => `${item.name}${item.variantName ? ` (${item.variantName})` : ''} × ${item.quantity}`)
                        .join(', ')
                    : '—'}
                </p>
                {payOnDelivery && parcel.toCollect !== null && parcel.status !== 'CANCELLED' && (
                  <p>
                    {parcel.kind === 'PICKUP' ? 'Collect at the counter: ' : 'Courier collects: '}
                    <span className="font-medium tabular-nums">{formatMoney(parcel.toCollect, currency)}</span>
                  </p>
                )}
                {(parcel.dispatchedAt || parcel.trackingNote) && (
                  <p className="text-xs text-muted-foreground">
                    {parcel.dispatchedAt && `Sent ${formatDate(parcel.dispatchedAt)}`}
                    {parcel.deliveredAt && ` · delivered ${formatDate(parcel.deliveredAt)}`}
                    {parcel.trackingNote && ` · ${parcel.trackingNote}`}
                  </p>
                )}
                {parcel.broughtFrom.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">Brought here from other stores first</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {parcel.broughtFrom.map((t, i) => (
                        <li key={i}>
                          {t.itemName} × {t.quantity} from {t.storeName} —{' '}
                          {t.status === 'REQUESTED'
                            ? 'waiting for them to send it'
                            : t.status === 'DISPATCHED'
                              ? 'on its way'
                              : t.status === 'RECEIVED'
                                ? 'arrived'
                                : 'cancelled'}
                        </li>
                      ))}
                    </ul>
                    {waiting(parcel) && parcel.status === 'PENDING' && (
                      <p className="mt-1">
                        This parcel can go once everything has arrived —{' '}
                        <Link href="/inventory/transfers" className="text-primary hover:underline">
                          see transfers
                        </Link>
                        .
                      </p>
                    )}
                  </div>
                )}
                {!parcel.canWorkHere && parcel.status !== 'CANCELLED' && (
                  <p className="text-xs text-muted-foreground">
                    Not one of your stores — {parcel.storeName ?? 'that store'}’s team sends this parcel.
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Link
                  href={`/sales/orders/${orderId}/parcels/${parcel.id}`}
                  className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <Printer className="size-3.5" aria-hidden />
                  Packing slip
                </Link>
                {several && canManage && parcel.canWorkHere && parcel.status === 'PENDING' && canSend && !waiting(parcel) && (
                  <Button size="sm" onClick={() => setSending(parcel)} disabled={pending}>
                    Send parcel
                  </Button>
                )}
                {several && canManage && parcel.canWorkHere && parcel.status === 'DISPATCHED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPaymentCollected(true);
                      setDelivering(parcel);
                    }}
                    disabled={pending}
                  >
                    Mark delivered
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <DialogRoot open={sending !== null} onOpenChange={(open) => !open && !pending && setSending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send the parcel from {sending?.storeName ?? 'this store'}?</DialogTitle>
            <DialogDescription>
              Its items leave {sending?.storeName ?? 'the store'}’s shelf now. The customer is emailed once every parcel
              has been sent.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <Label htmlFor="parcel-tracking">Courier or tracking note</Label>
            <Input
              id="parcel-tracking"
              maxLength={200}
              placeholder="e.g. GIG Logistics, waybill 12345"
              value={trackingNote}
              onChange={(e) => setTrackingNote(e.target.value)}
            />
            <FieldDescription>Optional — only your team sees it.</FieldDescription>
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm" disabled={pending}>
                Not yet
              </Button>
            </DialogClose>
            <Button size="sm" disabled={pending} onClick={() => sending && void run(sending, 'send')}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Send parcel
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>

      <DialogRoot open={delivering !== null} onOpenChange={(open) => !open && !pending && setDelivering(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark the parcel from {delivering?.storeName ?? 'this store'} delivered?</DialogTitle>
            <DialogDescription>
              {outstanding === 1
                ? 'This is the last parcel, so the order will be marked delivered and the customer emailed.'
                : 'The order is marked delivered once every parcel has arrived.'}
            </DialogDescription>
          </DialogHeader>
          {payOnDelivery && outstanding === 1 && (
            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div>
                <Label htmlFor="parcel-collected">Every courier has handed over the money</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatMoney(totalAmount, currency)} in all. Turn this off if some hasn’t reached you yet — you can
                  record it later.
                </p>
              </div>
              <SwitchRoot id="parcel-collected" checked={paymentCollected} onCheckedChange={setPaymentCollected} />
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm" disabled={pending}>
                Back
              </Button>
            </DialogClose>
            <Button size="sm" disabled={pending} onClick={() => delivering && void run(delivering, 'deliver')}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Mark delivered
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    </section>
  );
}
