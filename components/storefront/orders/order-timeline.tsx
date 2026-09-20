/*
 * Where an order has got to.
 *
 * A track with one dot per stage, the reached ones filled. Only the first
 * stage carries a time, because that is the only one this app can currently
 * put a clock on — an invented "packed at 14:02" is exactly the detail a
 * shopper would quote back at someone.
 *
 * A cancelled order gets a plain statement instead of a broken track: it has
 * a state, not a stage.
 */
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/storefront/format';
import { orderTimeline } from '@/lib/storefront/orders/labels';
import type { OrderStatus, StorefrontOrder } from '@/lib/storefront/orders/types';

const CANCELLED_BECAUSE: Record<NonNullable<StorefrontOrder['cancellation']>['by'], string> = {
  customer: 'You cancelled this order',
  merchant: 'The store cancelled this order',
  'payment-timeout': 'This order was cancelled because the payment didn’t arrive in time',
};

export function OrderTimeline({
  status,
  placedAt,
  stageDates,
  cancellation,
  locale,
}: {
  status: OrderStatus;
  placedAt: string;
  stageDates?: StorefrontOrder['stageDates'];
  cancellation?: StorefrontOrder['cancellation'];
  locale: string;
}) {
  if (status === 'CANCELLED') {
    return (
      <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
        {CANCELLED_BECAUSE[cancellation?.by ?? 'merchant']}
        {cancellation?.at ? ` on ${formatDate(cancellation.at, locale)}` : ''}. Its items went back on sale.
      </p>
    );
  }

  const steps = orderTimeline(status, placedAt, stageDates);

  return (
    <ol className="space-y-0">
      {steps.map((step, index) => (
        <li key={step.status} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
                step.done
                  ? 'border-brand bg-brand text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground',
              )}
              aria-hidden
            >
              {step.done ? <Check className="size-3.5" /> : index + 1}
            </span>
            {index < steps.length - 1 && (
              <span
                className={cn('w-px flex-1', step.done ? 'bg-brand/40' : 'bg-border')}
                aria-hidden
              />
            )}
          </div>

          <div className={cn('pb-6', index === steps.length - 1 && 'pb-0')}>
            <p className={cn('text-sm', step.current ? 'font-semibold' : 'font-medium')}>
              {step.label}
              {step.current && <span className="sr-only"> — current stage</span>}
            </p>
            <p className="text-sm text-muted-foreground">{step.description}</p>
            {step.at && (
              <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(step.at, locale)}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
