/*
 * An order's state, said in words a shopper can act on.
 *
 * Colour is never the only signal — every pill has a text label, because a
 * shopper reading on a phone in sunlight, or colour-blind, or through a
 * screen reader, gets exactly the same answer as everyone else.
 */
import { cn } from '@/lib/utils';
import { ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from '@/lib/storefront/orders/labels';
import type { OrderPaymentStatus, OrderStatus } from '@/lib/storefront/orders/types';

const STATUS_TONE: Record<OrderStatus, string> = {
  PENDING: 'bg-secondary text-foreground',
  CONFIRMED: 'bg-secondary text-foreground',
  PROCESSING: 'bg-highlight/25 text-foreground',
  SHIPPED: 'bg-teal-soft text-foreground',
  DELIVERED: 'bg-success/15 text-foreground',
  CANCELLED: 'bg-destructive/10 text-destructive',
};

export function OrderStatusPill({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold',
        STATUS_TONE[status],
        className,
      )}
    >
      {ORDER_STATUS_LABEL[status]}
    </span>
  );
}

export function PaymentStatusPill({ status }: { status: OrderPaymentStatus }) {
  const settled = status === 'PAID';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium',
        settled ? 'border-success/40 text-foreground' : 'border-border text-muted-foreground',
      )}
    >
      {PAYMENT_STATUS_LABEL[status]}
    </span>
  );
}
