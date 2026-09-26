/*
 * Delivery and returns.
 *
 * Every figure here comes from `getDeliveryPromise()`, which reads the
 * merchant's own delivery zones, pickup points and return window — so this
 * panel cannot promise something checkout or the returns form then
 * contradicts. The exact price depends on the address, confirmed at checkout.
 * A store that hasn't set a return window says nothing about returns.
 *
 * Server component.
 */
import Link from 'next/link';
import { ArrowRight, CreditCard, RotateCcw, Store, Truck } from 'lucide-react';
import { formatMoney } from '@/lib/storefront/format';
import type { DeliveryPromise } from '@/lib/storefront/types';

export function ProductDelivery({
  delivery,
  requiresPrepayment = false,
}: {
  delivery: DeliveryPromise;
  /** the merchant wants this item paid for before it's delivered */
  requiresPrepayment?: boolean;
}) {
  const { options, returnWindowDays, currency, policyPage } = delivery;
  const shipping = options.filter((o) => o.kind !== 'pickup');
  const pickups = options.filter((o) => o.kind === 'pickup');

  const price = (option: DeliveryPromise['options'][number]) =>
    option.free ? 'Free' : `${option.fromPrice ? 'From ' : ''}${formatMoney(option.price, currency)}`;

  return (
    <section aria-labelledby="delivery-heading" className="mt-8 rounded-2xl border bg-card p-5">
      <h2 id="delivery-heading" className="flex items-center gap-2 text-sm font-semibold">
        <Truck aria-hidden className="size-4 text-teal" />
        Delivery &amp; returns
      </h2>

      {shipping.length > 0 ? (
        <dl className="mt-4 space-y-3 text-sm">
          {shipping.map((option) => (
            <div key={option.id} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <dt className="font-medium">{option.label}</dt>
                <dd className="text-xs text-muted-foreground">
                  {option.detail}
                  {option.freeOver ? ` · free over ${formatMoney(option.freeOver, currency)}` : ''}
                </dd>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{price(option)}</span>
            </div>
          ))}
        </dl>
      ) : (
        pickups.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            This store hasn’t set up delivery yet, so orders can’t be placed right now.
          </p>
        )
      )}

      {(pickups.length > 0 || Boolean(returnWindowDays)) && (
        <ul className="mt-4 space-y-2.5 border-t pt-4 text-sm text-muted-foreground">
          {pickups.map((pickup) => (
            <li key={pickup.id} className="flex items-start gap-2.5">
              <Store aria-hidden className="mt-0.5 size-4 shrink-0 text-teal" />
              <span>
                {pickup.label} — {pickup.detail} ({price(pickup).toLowerCase()})
              </span>
            </li>
          ))}
          {returnWindowDays ? (
            <li className="flex items-start gap-2.5">
              <RotateCcw aria-hidden className="mt-0.5 size-4 shrink-0 text-teal" />
              Ask to return items within {returnWindowDays} days of delivery, from your account
            </li>
          ) : null}
        </ul>
      )}

      {/* Said here rather than sprung on the shopper at the payment step. */}
      {requiresPrepayment && (
        <p className="mt-4 flex items-start gap-2.5 border-t pt-4 text-sm">
          <CreditCard aria-hidden className="mt-0.5 size-4 shrink-0 text-teal" />
          <span>
            This item is paid for before delivery — pay on delivery isn’t available for an order containing it.
          </span>
        </p>
      )}

      {shipping.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Delivery times run from dispatch. Your exact options and price depend on your address and are confirmed at
          checkout.
        </p>
      )}

      {/* The merchant's own words on delivery and returns, when they've
        * published some — the figures above are the rules, that page is
        * the detail. */}
      {policyPage && (
        <Link
          href={policyPage.href}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground underline underline-offset-4"
        >
          {policyPage.title}
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      )}
    </section>
  );
}
