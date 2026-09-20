'use client';

/*
 * The next step for an online order, as buttons.
 *
 * Only the move that makes sense right now is offered, as the one primary
 * button; cancelling is always secondary and always asks first, because it
 * gives the stock back and emails the customer. Which moves are allowed is
 * decided on the server (lib/storefront/orders/lifecycle.ts) — this component
 * only chooses what to show, and shows the server's reason when it says no.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SwitchRoot } from '@/components/ui/switch';
import {
  AlertDialogRoot,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
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
import { updateStoreOrder, type StoreOrderAction } from '@/features/sales/orders';
import { formatMoney } from '@/lib/format';

const SUCCESS: Record<StoreOrderAction, string> = {
  confirm: 'Order confirmed',
  'confirm-transfer': 'Transfer confirmed — the order is paid and the customer emailed',
  pack: 'Moved to packing — the customer can see it’s being packed',
  ship: 'Marked as shipped — stock updated and the customer emailed',
  deliver: 'Marked as delivered',
  'record-payment': 'Payment recorded',
  cancel: 'Order cancelled — stock released and the customer emailed',
};

export function OrderActions({
  orderId,
  status,
  paymentStatus,
  cancelReason,
  reference,
  totalAmount,
  currency,
}: {
  orderId: string;
  status: string;
  paymentStatus: string;
  cancelReason: string | null;
  reference: string;
  /** major units */
  totalAmount: number;
  currency: string;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<StoreOrderAction | null>(null);
  const [deliverOpen, setDeliverOpen] = React.useState(false);
  const [paymentCollected, setPaymentCollected] = React.useState(true);

  const payOnDelivery = paymentStatus === 'DUE_ON_DELIVERY';
  const awaitingOnlinePayment = paymentStatus === 'AWAITING_PAYMENT';
  const awaitingTransfer = paymentStatus === 'AWAITING_TRANSFER';
  /* A late transfer can still be confirmed after the order expired unpaid. */
  const canConfirmTransfer =
    awaitingTransfer && (status === 'PENDING' || (status === 'CANCELLED' && cancelReason === 'payment-timeout'));
  const cancellable = ['PENDING', 'CONFIRMED', 'PROCESSING'].includes(status);

  async function run(action: StoreOrderAction, options?: { paymentCollected?: boolean }) {
    setPending(action);
    const result = await updateStoreOrder(orderId, action, options);
    setPending(null);
    if (!result.success) {
      toast.error(result.error);
      return false;
    }
    if (result.data.warning) toast.warning(result.data.warning, { duration: 10_000 });
    else toast.success(SUCCESS[action]);
    router.refresh();
    return true;
  }

  const spinner = (action: StoreOrderAction) =>
    pending === action ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {cancellable && (
        <AlertDialogRoot>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={pending !== null}>
              Cancel order
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
              <AlertDialogDescription>
                The items go back on sale and the customer gets an email saying the order was cancelled.
                {paymentStatus === 'PAID' &&
                  ' They have already paid — you’ll need to send the money back, then record the refund on this page.'}{' '}
                This can’t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep order</AlertDialogCancel>
              <AlertDialogAction onClick={() => void run('cancel')}>Cancel order</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogRoot>
      )}

      {canConfirmTransfer && (
        <AlertDialogRoot>
          <AlertDialogTrigger asChild>
            <Button size="sm" disabled={pending !== null}>
              {spinner('confirm-transfer')}
              Confirm transfer received
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Has the transfer arrived?</AlertDialogTitle>
              <AlertDialogDescription>
                Check your bank for {formatMoney(totalAmount, currency)} with the reference {reference}. Confirming marks
                the order as paid and confirmed, and emails the customer. Only confirm once the money is in your account.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Not yet</AlertDialogCancel>
              <Button size="sm" onClick={() => void run('confirm-transfer')} disabled={pending !== null}>
                {spinner('confirm-transfer')}
                Yes, it’s arrived
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogRoot>
      )}

      {status === 'PENDING' && !awaitingOnlinePayment && !awaitingTransfer && (
        <Button size="sm" onClick={() => void run('confirm')} disabled={pending !== null}>
          {spinner('confirm')}
          Confirm order
        </Button>
      )}

      {/* Packing is optional: a confirmed order can ship straight away, so
        * "Mark as shipped" stays available — secondary until packing starts. */}
      {status === 'CONFIRMED' && (
        <>
          <Button variant="outline" size="sm" onClick={() => void run('ship')} disabled={pending !== null}>
            {spinner('ship')}
            Mark as shipped
          </Button>
          <Button size="sm" onClick={() => void run('pack')} disabled={pending !== null}>
            {spinner('pack')}
            Start packing
          </Button>
        </>
      )}

      {status === 'PROCESSING' && (
        <Button size="sm" onClick={() => void run('ship')} disabled={pending !== null}>
          {spinner('ship')}
          Mark as shipped
        </Button>
      )}

      {status === 'SHIPPED' && (
        <>
          <Button
            size="sm"
            onClick={() => (payOnDelivery ? setDeliverOpen(true) : void run('deliver'))}
            disabled={pending !== null}
          >
            {spinner('deliver')}
            Mark as delivered
          </Button>

          <DialogRoot open={deliverOpen} onOpenChange={setDeliverOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Mark as delivered</DialogTitle>
                <DialogDescription>This order is pay on delivery.</DialogDescription>
              </DialogHeader>
              <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                <div>
                  <Label htmlFor="payment-collected">The customer paid the courier</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Turn this off if the money hasn’t reached you yet — you can record it later.
                  </p>
                </div>
                <SwitchRoot
                  id="payment-collected"
                  checked={paymentCollected}
                  onCheckedChange={setPaymentCollected}
                />
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" size="sm">
                    Back
                  </Button>
                </DialogClose>
                <Button
                  size="sm"
                  disabled={pending !== null}
                  onClick={async () => {
                    if (await run('deliver', { paymentCollected })) setDeliverOpen(false);
                  }}
                >
                  {spinner('deliver')}
                  Mark as delivered
                </Button>
              </DialogFooter>
            </DialogContent>
          </DialogRoot>
        </>
      )}

      {status === 'DELIVERED' && payOnDelivery && (
        <Button size="sm" onClick={() => void run('record-payment')} disabled={pending !== null}>
          {spinner('record-payment')}
          Record payment
        </Button>
      )}
    </div>
  );
}
