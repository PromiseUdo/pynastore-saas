'use client';

/*
 * Step 4 — check it, then place it.
 *
 * The last chance to catch a mistake, so everything the order will be made
 * of is repeated here in one place: who it's for, where it goes, how it
 * travels, how it's paid, what's in it and what it costs. Every block has
 * its own Edit, which jumps back to that step — not to the top of the form —
 * because "fix my house number" should not mean re-reading four sections.
 *
 * Nothing is re-entered here: Edit navigates, and the form was never
 * unmounted, so the shopper lands on their own values with the cursor
 * somewhere useful.
 *
 * The order note lives here rather than earlier: it is the one field nobody
 * needs to think about until they can see the whole order.
 *
 * Place Order is NOT in this file — it is the shell's primary action, so
 * there is exactly one of it, and its disabled/loading state is the one the
 * store controls.
 */
import Image from 'next/image';
import { ProductImage } from '@/components/storefront/product/product-image';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import type { CartItem } from '@/lib/storefront/types';
import type {
  CheckoutConfig,
  CheckoutStepId,
  OrderTotals,
  ShippingMethod,
} from '@/lib/storefront/checkout/types';
import type { CheckoutFormValues } from '@/lib/storefront/checkout/schema';
import { deliveryEstimate, findPaymentMethod } from '@/lib/storefront/checkout/config';
import { addressLines } from '@/lib/storefront/checkout/address';
import { lineKey } from '@/lib/storefront/cart';
import { formatMoney } from '@/lib/storefront/format';
import { lineSubtotal } from '@/lib/storefront/checkout/totals';
import { NoteField } from './checkout-fields';

function ReviewBlock({
  title,
  step,
  onEdit,
  children,
}: {
  title: string;
  step: CheckoutStepId;
  onEdit: (step: CheckoutStepId) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        <div className="mt-1.5 text-sm leading-relaxed">{children}</div>
      </div>
      {/* Four buttons all reading "Edit" is useless to anyone listening to
        * the page, so each gets a name of its own. The visible word stays
        * inside that name, which is what WCAG's "label in name" asks for. */}
      <button
        type="button"
        onClick={() => onEdit(step)}
        aria-label={`Edit ${title.toLowerCase()}`}
        className="shrink-0 rounded-full px-2 py-1 text-sm font-semibold text-brand transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Edit
      </button>
    </div>
  );
}

export function ReviewStep({
  form,
  config,
  items,
  totals,
  deliveryMethod,
  onEdit,
  onNoteChange,
}: {
  form: UseFormReturn<CheckoutFormValues>;
  config: CheckoutConfig;
  items: CartItem[];
  totals: OrderTotals;
  deliveryMethod: ShippingMethod | null;
  onEdit: (step: CheckoutStepId) => void;
  onNoteChange: (note: string) => void;
}) {
  const { register, control, formState } = form;
  /* useWatch, not form.watch(): with the React Compiler on (next.config.ts)
   * a watch() call is memoised away and the choice never re-renders. */
  const [contact, address, paymentMethodId] = useWatch({
    control,
    name: ['contact', 'address', 'paymentMethodId'],
  });
  const payment = findPaymentMethod(config, paymentMethodId ?? null);

  /* The address is shown with the recipient filled in from contact, exactly
   * as the order will carry it — see `addressFromContact`. */
  const lines = addressLines(
    {
      ...address,
      firstName: address.firstName || contact.firstName,
      lastName: address.lastName || contact.lastName,
      phone: address.phone || contact.phone,
    },
    config,
  );

  return (
    <div className="space-y-7">
      <div className="divide-y rounded-2xl border bg-card px-5">
        <ReviewBlock title="Contact" step="information" onEdit={onEdit}>
          <p>
            {contact.firstName} {contact.lastName}
          </p>
          <p className="text-muted-foreground">{contact.email}</p>
          <p className="text-muted-foreground">{contact.phone}</p>
        </ReviewBlock>

        <ReviewBlock title="Delivery address" step="information" onEdit={onEdit}>
          {lines.map((line) => (
            <p key={line} className="text-muted-foreground first:text-foreground">
              {line}
            </p>
          ))}
        </ReviewBlock>

        <ReviewBlock title="Delivery method" step="delivery" onEdit={onEdit}>
          {deliveryMethod ? (
            <>
              <p>{deliveryMethod.label}</p>
              <p className="text-muted-foreground">
                {deliveryEstimate(deliveryMethod)} ·{' '}
                {deliveryMethod.price === 0
                  ? 'Free'
                  : formatMoney(deliveryMethod.price, totals.currency)}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">Not chosen yet</p>
          )}
        </ReviewBlock>

        <ReviewBlock title="Payment" step="payment" onEdit={onEdit}>
          {payment ? (
            <>
              <p>{payment.label}</p>
              <p className="text-muted-foreground">{payment.handoffNote}</p>
            </>
          ) : (
            <p className="text-muted-foreground">Not chosen yet</p>
          )}
        </ReviewBlock>
      </div>

      {/* Repeated here so the whole order is reviewable in one scroll on a
       * phone, where the summary panel is collapsed. Same lines, same sums —
       * `lineSubtotal` and `totals` come from the one calculation. */}
      <section aria-labelledby="review-items-heading" className="rounded-2xl border bg-card p-5">
        <h3 id="review-items-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {items.length} item{items.length === 1 ? '' : 's'} in this order
        </h3>
        <ul className="mt-3 divide-y">
          {items.map((item) => (
            <li key={lineKey(item)} className="flex items-center gap-3 py-3">
              <ProductImage
                src={item.imageUrl}
                name={item.name}
                alt=""
                width={48}
                height={60}
                className="h-[60px] w-12 rounded-lg bg-tile object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 text-sm font-medium">{item.name}</p>
                {item.optionSummary && (
                  <p className="text-xs text-muted-foreground">{item.optionSummary}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Qty {item.quantity} · {formatMoney(item.unitPrice, item.currency)} each
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums">
                {formatMoney(lineSubtotal(item), item.currency)}
              </p>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-2 border-t pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="font-medium tabular-nums">{formatMoney(totals.subtotal, totals.currency)}</dd>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Discount</dt>
              <dd className="font-medium tabular-nums text-success">
                −{formatMoney(totals.discount, totals.currency)}
              </dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Delivery</dt>
            <dd className="font-medium tabular-nums">
              {totals.shipping === 0 ? 'Free' : formatMoney(totals.shipping, totals.currency)}
            </dd>
          </div>
          <div className="flex justify-between border-t pt-2.5">
            <dt className="font-semibold">Total</dt>
            <dd className="text-base font-bold tabular-nums">
              {formatMoney(totals.total, totals.currency)}
            </dd>
          </div>
        </dl>
      </section>

      {config.orderNotesEnabled && (
        <NoteField
          id="order-note"
          label="Order note"
          hint="Delivery instructions, a gift message, anything we should know."
          error={formState.errors.orderNote?.message}
          {...register('orderNote', {
            onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onNoteChange(event.target.value),
          })}
        />
      )}
    </div>
  );
}
