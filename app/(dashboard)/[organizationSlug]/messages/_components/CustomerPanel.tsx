'use client';

/*
 * Who the merchant is talking to, and what about. Only what the member may
 * see: an email needs `customer.view`, an order count `sales.view` (the
 * server leaves out whatever they can't — this just doesn't pretend).
 * Nothing sensitive beyond that, and nothing about a guest but the name they
 * chose to give.
 */
import Link from 'next/link';
import { ExternalLink, Package } from 'lucide-react';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import type { StaffConversation } from '@/lib/chat/service';
import type { ChatProductCardView } from '@/lib/chat/inbox-client';
import type { MessagesPermissions } from './MessagesPageClient';

export function CustomerPanel({
  conversation,
  product,
  currency,
  can,
}: {
  conversation: StaffConversation;
  product: ChatProductCardView | null;
  currency: string;
  can: MessagesPermissions;
}) {
  const customer = conversation.customer;
  return (
    <div className="space-y-5 text-sm">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer</h3>
        {customer ? (
          <dl className="mt-2 space-y-2">
            <Fact label="Name">{conversation.name ?? '—'}</Fact>
            {can.viewCustomers && <Fact label="Email">{customer.email ?? '—'}</Fact>}
            <Fact label="Customer since">{formatDate(customer.customerSince)}</Fact>
            {can.viewOrders && <Fact label="Orders">{formatNumber(customer.orderCount ?? 0)}</Fact>}
            {can.viewCustomers && (
              <Link
                href={`/sales/customers/${customer.id}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                View customer
                <ExternalLink className="size-3" aria-hidden />
              </Link>
            )}
          </dl>
        ) : (
          <dl className="mt-2 space-y-2">
            <Fact label="Name">{conversation.name ?? 'Not given'}</Fact>
            <p className="text-xs text-muted-foreground">
              A guest — they haven’t signed in to an account with your shop, so there are no orders or contact details to show.
            </p>
          </dl>
        )}
      </section>

      {product && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Asked about</h3>
          <ProductCard product={product} currency={currency} linkable={can.viewProducts} className="mt-2" />
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversation</h3>
        <dl className="mt-2 space-y-2">
          <Fact label="Started">{formatDate(conversation.createdAt)}</Fact>
          {conversation.resolvedAt && conversation.status === 'RESOLVED' && <Fact label="Resolved">{formatDate(conversation.resolvedAt)}</Fact>}
        </dl>
      </section>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

/** A product a message was sent from — in the panel and above the message itself. */
export function ProductCard({
  product,
  currency,
  linkable,
  className,
}: {
  product: ChatProductCardView;
  currency: string;
  linkable: boolean;
  className?: string;
}) {
  const body = (
    <>
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a Cloudinary thumbnail, already sized
        <img src={product.imageUrl} alt="" className="size-10 shrink-0 rounded object-cover" />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
          <Package className="size-4" aria-hidden />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{product.name}</span>
        <span className="block text-xs tabular-nums text-muted-foreground">{formatMoney(product.price, currency)}</span>
      </span>
    </>
  );
  const classes = `flex max-w-xs items-center gap-2.5 rounded-md border bg-card p-2 ${className ?? ''}`;
  return linkable ? (
    <Link href={`/inventory/products/${product.id}`} className={`${classes} transition-colors hover:bg-muted/60`}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
