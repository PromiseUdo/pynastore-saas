'use client';

/*
 * What you're buying and what it costs — visible for the whole of checkout.
 *
 * ONE CART, ONE SUM. The lines come from the cart store (the same bag the
 * header badge and /cart read) and every figure comes from
 * `calculateCheckoutTotals`, which delegates to `computeTotals` in
 * lib/storefront/pricing.ts. There is no second cart and no second
 * calculation anywhere in checkout.
 *
 * TWO SHAPES, ONE COMPONENT:
 *
 *   desktop — a sticky panel in the right column, always open. The shopper
 *             works down the form with the total in view, which is the
 *             single biggest anxiety-reducer in a checkout.
 *   phone   — a collapsed bar at the top: "Order summary · ₦123,000", tap to
 *             expand. The total is the part people actually want, and it is
 *             on screen without a list of thumbnails eating half the
 *             viewport. Built on <details>/<summary>, so it works before
 *             hydration and needs no JavaScript to open.
 *
 * CURRENCY is never written as a symbol here. It comes from the store's
 * config (or the line's own snapshot) via `checkoutCurrency` and is
 * formatted by `formatMoney` — so an NGN store and a GBP store need no
 * change to this file.
 */
import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronDown, Lock, Pencil } from 'lucide-react';
import type { AppliedCoupon, CartItem } from '@/lib/storefront/types';
import type { CheckoutConfig, OrderTotals, ShippingMethod } from '@/lib/storefront/checkout/types';
import { lineKey } from '@/lib/storefront/cart';
import { formatMoney } from '@/lib/storefront/format';
import { lineSubtotal } from '@/lib/storefront/checkout/totals';
import { deliveryEstimate } from '@/lib/storefront/checkout/config';
import { DiscountCodeBox } from '@/components/storefront/common/discount-code-box';

/* ---------------- pieces ---------------- */

function Line({ item }: { item: CartItem }) {
  return (
    <li className="flex gap-3 py-3">
      <div className="relative shrink-0">
        <Image
          src={item.imageUrl}
          alt=""
          width={56}
          height={70}
          className="h-[70px] w-14 rounded-lg bg-tile object-cover"
        />
        <span className="absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full bg-foreground px-1.5 text-[11px] font-semibold text-background">
          {item.quantity}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{item.name}</p>
        {item.optionSummary && (
          <p className="mt-0.5 text-xs text-muted-foreground">{item.optionSummary}</p>
        )}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {item.quantity} × {formatMoney(item.unitPrice, item.currency)}
        </p>
      </div>

      <p className="shrink-0 text-sm font-semibold tabular-nums">
        {formatMoney(lineSubtotal(item), item.currency)}
      </p>
    </li>
  );
}

function Row({
  label,
  hint,
  value,
  strong,
}: {
  label: string;
  hint?: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={strong ? 'font-semibold' : 'text-sm text-muted-foreground'}>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className={strong ? 'text-lg font-bold tabular-nums' : 'text-sm font-medium tabular-nums'}>
        {value}
      </span>
    </div>
  );
}

/* ---------------- the panel ---------------- */

function SummaryBody({
  items,
  totals,
  deliveryMethod,
  coupon,
  config,
}: {
  items: CartItem[];
  totals: OrderTotals;
  deliveryMethod: ShippingMethod | null;
  coupon: AppliedCoupon | null;
  config: CheckoutConfig;
}) {
  const { subtotal, discount, shipping, tax, total, currency } = totals;

  return (
    <>
      <ul className="divide-y">
        {items.map((item) => (
          <Line key={lineKey(item)} item={item} />
        ))}
      </ul>

      {/* Here as well as in the bag: most shoppers reach checkout from the
        * mini-cart and never open /cart, and a code they can't spend is worse
        * than a field they ignore. */}
      <DiscountCodeBox currency={currency} className="mt-4 border-t pt-4" />

      <div className="mt-4 space-y-2.5 border-t pt-4">
        <Row label="Subtotal" value={formatMoney(subtotal, currency)} />

        {discount > 0 && (
          <Row
            label="Discount"
            hint={coupon?.code}
            value={<span className="text-success">−{formatMoney(discount, currency)}</span>}
          />
        )}

        <Row
          label="Delivery"
          hint={deliveryMethod ? deliveryEstimate(deliveryMethod) : 'Depends on your address'}
          value={
            totals.shippingPending ? 'Not chosen yet' : shipping === 0 ? 'Free' : formatMoney(shipping, currency)
          }
        />

        {/* Tax is a tenant setting, not a hardcoded row — and this store's
         * prices already include VAT, so by default there is no line here
         * at all rather than a decorative ₦0. */}
        {config.taxEnabled && (
          <Row label="VAT" hint="Included in the prices shown" value={formatMoney(tax, currency)} />
        )}

        <div className="border-t pt-3">
          <Row label={totals.shippingPending ? 'Total before delivery' : 'Total'} value={formatMoney(total, currency)} strong />
          {!config.taxEnabled && (
            <p className="mt-1 text-xs text-muted-foreground">
              Includes {formatMoney(tax, currency)} VAT
            </p>
          )}
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Your total is confirmed before any payment is taken.
      </p>
    </>
  );
}

export function CheckoutSummary({
  items,
  totals,
  deliveryMethod,
  coupon,
  config,
  itemCount,
}: {
  items: CartItem[];
  totals: OrderTotals;
  deliveryMethod: ShippingMethod | null;
  /* The code is applied in the BAG, not here: a shopper who is this far in
   * should be finishing, and "edit bag" is a tap away. Checkout only shows
   * what it's worth, so the total is never a surprise. */
  coupon: AppliedCoupon | null;
  config: CheckoutConfig;
  itemCount: number;
}) {
  const countLabel = `${itemCount} item${itemCount === 1 ? '' : 's'}`;

  return (
    <>
      {/* ── phone: collapsed by default ─────────────────────────────── */}
      <details className="group rounded-xl border bg-card lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            Order summary
            <ChevronDown
              className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden
            />
          </span>
          <span className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground">{countLabel}</span>
            <span className="font-semibold tabular-nums">
              {formatMoney(totals.total, totals.currency)}
            </span>
          </span>
        </summary>
        <div className="border-t px-4 pb-4 pt-1">
          <SummaryBody items={items} totals={totals} deliveryMethod={deliveryMethod} coupon={coupon} config={config} />
          <Link
            href="/cart"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-brand"
          >
            <Pencil className="size-3.5" aria-hidden /> Edit your bag
          </Link>
        </div>
      </details>

      {/* ── desktop: open, sticky ───────────────────────────────────── */}
      <section
        aria-labelledby="checkout-summary-heading"
        className="hidden rounded-2xl border bg-card p-5 lg:sticky lg:top-8 lg:block"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="checkout-summary-heading" className="font-display text-lg">
            Order summary
          </h2>
          <Link href="/cart" className="text-xs font-medium text-muted-foreground hover:text-brand">
            Edit bag
          </Link>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{countLabel}</p>
        <div className="mt-4">
          <SummaryBody items={items} totals={totals} deliveryMethod={deliveryMethod} coupon={coupon} config={config} />
        </div>
      </section>
    </>
  );
}
