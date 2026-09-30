/*
 * Delivery and returns — what holds for this item wherever the shopper is:
 * where it can be collected, the return window, whether it must be paid
 * before delivery, and the merchant's own delivery and returns page.
 *
 * What delivery COSTS isn't listed here. That depends on which store the item
 * leaves from and where it's going (ROADMAP Phase 9), and a table of every
 * store's zones put prices that don't apply beside the one that does —
 * "Within Port Harcourt · Free" above an item that ships from Lagos. The
 * "Deliver to" box above answers it for this shopper (deliver-to-estimate.tsx).
 *
 * Every figure comes from `getDeliveryPromise()`, the merchant's own pickup
 * points and return window. A store that hasn't set a return window says
 * nothing about returns. Server component.
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
  const pickups = options.filter((o) => o.kind === 'pickup');
  const nothingSetUp = options.length === 0;

  const price = (option: DeliveryPromise['options'][number]) =>
    option.free ? 'Free' : `${option.fromPrice ? 'From ' : ''}${formatMoney(option.price, currency)}`;

  // Nothing that holds wherever the shopper is: the "Deliver to" box says it all.
  if (!nothingSetUp && pickups.length === 0 && !returnWindowDays && !requiresPrepayment && !policyPage) return null;

  return (
    <section aria-labelledby="delivery-heading" className="mt-8 rounded-2xl border bg-card p-5">
      <h2 id="delivery-heading" className="flex items-center gap-2 text-sm font-semibold">
        <Truck aria-hidden className="size-4 text-teal" />
        Delivery &amp; returns
      </h2>

      {nothingSetUp && (
        <p className="mt-4 text-sm text-muted-foreground">
          This store hasn’t set up delivery yet, so orders can’t be placed right now.
        </p>
      )}

      {(pickups.length > 0 || Boolean(returnWindowDays)) && (
        <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
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
