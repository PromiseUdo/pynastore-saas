'use client';

/*
 * The shopper's return requests on one order, newest first: what's going
 * back, where each request has got to, what the store said, and what was
 * refunded. A request the store hasn't answered can be withdrawn — only from
 * the account, never from a guest lookup.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { withdrawReturnAction } from '@/features/shop-orders/aftercare';
import { RETURN_STATUS_LABEL, returnHint } from '@/lib/storefront/orders/labels';
import { formatDate, formatMoney } from '@/lib/storefront/format';
import type { OrderReturnStatus, StorefrontOrder } from '@/lib/storefront/orders/types';

const TONE: Record<OrderReturnStatus, string> = {
  REQUESTED: 'bg-secondary text-foreground',
  APPROVED: 'bg-brand/10 text-brand',
  REJECTED: 'bg-destructive/10 text-destructive',
  REFUNDED: 'bg-success/10 text-success',
  WITHDRAWN: 'bg-secondary text-muted-foreground',
};

export function OrderReturns({
  order,
  locale,
  canWithdraw,
}: {
  order: StorefrontOrder;
  locale: string;
  canWithdraw: boolean;
}) {
  if (order.returns.length === 0) return null;

  return (
    <section aria-labelledby="order-returns" className="rounded-3xl border border-border bg-card p-5 sm:p-6">
      <h2 id="order-returns" className="text-sm font-semibold">
        Returns
      </h2>
      <ul className="mt-4 space-y-4">
        {order.returns.map((r) => (
          <li key={r.id} className="rounded-2xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', TONE[r.status])}>
                {RETURN_STATUS_LABEL[r.status]}
              </span>
              <span className="text-xs text-muted-foreground">Asked {formatDate(r.requestedAt, locale)}</span>
            </div>

            <ul className="mt-3 space-y-1 text-sm">
              {r.lines.map((line) => (
                <li key={line.orderLineItemId}>
                  {line.name}
                  {line.variantName && <span className="text-muted-foreground"> · {line.variantName}</span>}
                  <span className="text-muted-foreground tabular-nums"> × {line.quantity}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              {r.reasonLabel}
              {r.details ? ` — “${r.details}”` : ''}
            </p>

            {r.storeNote && (r.status === 'APPROVED' || r.status === 'REJECTED' || r.status === 'REFUNDED') && (
              <div className="mt-3 rounded-xl bg-secondary/50 px-3 py-2.5 text-sm">
                <p className="text-xs font-semibold text-muted-foreground">From the store</p>
                <p className="mt-0.5 whitespace-pre-line">{r.storeNote}</p>
              </div>
            )}

            <p className="mt-3 text-sm text-muted-foreground">
              {r.status === 'REFUNDED' && r.refunded !== null
                ? `The store says it has sent ${formatMoney(r.refunded, order.currency)} back to you. It can take a few working days to arrive.`
                : returnHint(r.status)}
            </p>

            {canWithdraw && r.status === 'REQUESTED' && <WithdrawButton returnId={r.id} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function WithdrawButton({ returnId }: { returnId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const withdraw = async () => {
    setPending(true);
    const result = await withdrawReturnAction({ returnId });
    setPending(false);
    if (!result.ok) {
      toast.error(result.message);
      router.refresh();
      return;
    }
    toast.success('Return request withdrawn');
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={withdraw}
      disabled={pending}
      aria-busy={pending}
      className="mt-3 inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-60"
    >
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      Withdraw request
    </button>
  );
}
