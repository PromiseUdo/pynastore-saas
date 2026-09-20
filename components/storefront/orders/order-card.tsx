/*
 * One order, as a row in a list.
 *
 * Shows the four things someone scanning their history is actually looking
 * for — which order, when, how far along, and how much — then the item
 * thumbnails as a reminder of what it was. The whole row is a link so a
 * thumb finds it on a phone.
 */
import Link from 'next/link';
import Image from 'next/image';
import { ChevronRight } from 'lucide-react';
import { formatDate, formatMoney } from '@/lib/storefront/format';
import type { StorefrontOrder } from '@/lib/storefront/orders/types';
import { OrderStatusPill } from './order-status';

export function OrderCard({ order, locale }: { order: StorefrontOrder; locale: string }) {
  const shown = order.lines.slice(0, 4);
  const extra = order.lines.length - shown.length;

  return (
    <Link
      href={`/account/orders/${order.reference}`}
      className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 transition-colors hover:border-brand/50"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tabular-nums">{order.reference}</p>
          <p className="text-xs text-muted-foreground">
            Placed {formatDate(order.placedAt, locale)} · {order.itemCount}{' '}
            {order.itemCount === 1 ? 'item' : 'items'}
          </p>
        </div>
        <OrderStatusPill status={order.status} />
      </div>

      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          {shown.map((line) =>
            line.imageUrl ? (
              <Image
                key={line.id}
                src={line.imageUrl}
                alt=""
                width={40}
                height={48}
                className="h-12 w-10 rounded-lg border border-card bg-tile object-cover"
              />
            ) : (
              <span
                key={line.id}
                className="h-12 w-10 rounded-lg border border-card bg-tile"
                aria-hidden
              />
            ),
          )}
          {extra > 0 && (
            <span className="flex h-12 w-10 items-center justify-center rounded-lg border border-card bg-secondary text-xs font-medium">
              +{extra}
            </span>
          )}
        </div>

        <p className="ml-auto text-sm font-semibold tabular-nums">
          {formatMoney(order.totals.total, order.currency)}
        </p>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
    </Link>
  );
}
