'use client';

/*
 * What the bag costs.
 *
 * Every number here comes from `computeTotals` (lib/storefront/pricing.ts),
 * the same function the mini-cart's subtotal and — later — the order use.
 * Nothing on this page adds up money itself, and nothing is stored: totals
 * are derived from the lines every time, so they cannot drift out of step
 * with what the shopper is looking at.
 *
 * The delivery figure is an ESTIMATE and says so. It is the storefront's
 * flat mock rate, not a rates engine and not a promise — the real figure
 * needs an address, which is checkout's job. Delivery is always charged:
 * there is no threshold that waives it, so no total here can read "Free".
 */
import Link from 'next/link';
import { formatMoney } from '@/lib/storefront/format';
import type { OrderTotals } from '@/lib/storefront/types';
import { DiscountCodeBox } from '@/components/storefront/common/discount-code-box';

function Row({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className={strong ? 'flex items-baseline justify-between gap-4' : 'flex items-baseline justify-between gap-4 text-sm'}>
      <span className={strong ? 'font-semibold' : 'text-muted-foreground'}>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className={strong ? 'text-lg font-bold tabular-nums' : 'font-medium tabular-nums'}>{value}</span>
    </div>
  );
}

export function OrderSummary({
  totals,
  itemCount,
  discountLabel,
}: {
  totals: OrderTotals;
  /** units, matching the header badge */
  itemCount: number;
  discountLabel?: string;
}) {
  const { subtotal, discount, shipping, tax, total, currency } = totals;

  return (
    <section aria-labelledby="order-summary-heading" className="rounded-2xl border bg-card p-5 sm:p-6">
      <h2 id="order-summary-heading" className="font-display text-lg">
        Order summary
      </h2>

      <DiscountCodeBox currency={currency} className="mt-5 border-b pb-5" />

      <div className="mt-5 space-y-3">
        <Row label={`Subtotal (${itemCount} item${itemCount === 1 ? '' : 's'})`} value={formatMoney(subtotal, currency)} />

        {discount > 0 && (
          <Row
            label={discountLabel ?? 'Discount'}
            value={<span className="text-success">−{formatMoney(discount, currency)}</span>}
          />
        )}

        {/* The price depends on the delivery address, which only checkout
          * asks for — so no figure here rather than a guess. */}
        <Row
          label="Delivery"
          hint={totals.shippingPending ? 'Depends on your address' : undefined}
          value={totals.shippingPending ? 'Calculated at checkout' : formatMoney(shipping, currency)}
        />

        <div className="border-t pt-3">
          <Row label={totals.shippingPending ? 'Total before delivery' : 'Total'} value={formatMoney(total, currency)} strong />
          <p className="mt-1 text-xs text-muted-foreground">Includes {formatMoney(tax, currency)} VAT</p>
        </div>
      </div>

      <Link
        href="/checkout"
        className="mt-5 flex h-12 w-full items-center justify-center rounded-full bg-brand text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
      >
        Checkout
      </Link>

      <Link
        href="/products"
        className="mt-3 flex h-11 w-full items-center justify-center rounded-full border text-sm font-semibold transition-colors hover:border-brand hover:text-brand"
      >
        Continue shopping
      </Link>
    </section>
  );
}
