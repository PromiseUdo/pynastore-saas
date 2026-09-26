'use client';

/*
 * The checkout, orchestrated.
 *
 * The one client component in the flow that holds state; the steps, the
 * summary and the fields below it are all views over what lives here. That
 * is deliberate — four steps each keeping their own copy of an address is
 * how a checkout starts losing what people typed.
 *
 * WHO OWNS WHAT
 *
 *   react-hook-form  the editing surface. Field values, touched/dirty state,
 *                    and per-field error messages while the shopper types.
 *                    The form is mounted ONCE for the whole flow — steps are
 *                    sections that show and hide, not pages that remount —
 *                    which is what makes going back lossless (Section 29).
 *
 *   checkout store   the checkout's own state: the committed draft, the
 *                    current step, the furthest step reached, submission
 *                    status and the last failure. Authoritative at submit.
 *
 *   cart store       the lines and their prices. Checkout READS the bag
 *                    through it and asks it to clear on success. Checkout
 *                    never touches localStorage and has no idea the bag is
 *                    stored there at all.
 *
 * Values flow one way — form → store — committed when a step is completed
 * and again before submitting, so the two can never disagree about what is
 * being ordered.
 *
 * VALIDATION is the whole zod schema (lib/storefront/checkout/schema.ts),
 * run per-step with `trigger(fields)` so a shopper on step 1 is never told
 * about a payment method they haven't reached. Errors render beside their
 * own field; the only message down here is the one the SERVICE returned,
 * which is about the order rather than a field.
 *
 * HYDRATION. The bag lives in the browser, so the server cannot know
 * whether there is anything to check out. This renders a skeleton until the
 * cart store rehydrates rather than flashing "nothing to check out" at
 * someone holding six items.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { quoteDeliveryAction } from '@/features/shop-orders/actions';
import { openPaymentPage } from '@/lib/storefront/payments/open-payment-page';
import { Skeleton } from '@/components/ui/skeleton';
import { useStorefront } from '@/lib/storefront/context';
import { useCartStore } from '@/lib/storefront/stores/cart-store';
import { useCheckoutStore } from '@/lib/storefront/stores/checkout-store';
import { useCartReconciliation } from '@/lib/storefront/use-cart-reconciliation';
import { describeNotice } from '@/lib/storefront/cart';
import { formatMoney } from '@/lib/storefront/format';
import { CHECKOUT_STEPS, type CheckoutConfig, type CheckoutStepId } from '@/lib/storefront/checkout/types';
import { checkoutSchema, STEP_FIELDS, type CheckoutFormValues } from '@/lib/storefront/checkout/schema';
import { calculateCheckoutTotals, checkoutItemCount } from '@/lib/storefront/checkout/totals';
import { isPaymentMethodAllowed } from '@/lib/storefront/checkout/payment-terms';
import type { ShippingMethod } from '@/lib/storefront/types';
import { emptyAddress, fromStoredAddress, toStoredAddress } from '@/lib/storefront/checkout/address';
import { saveCheckoutAddressAction } from '@/features/shop-account/address-actions';
import type { CheckoutAccount } from '@/lib/storefront/checkout/types';
import { USE_NEW_ADDRESS } from './saved-address-picker';
import { CheckoutProgress } from './checkout-progress';
import { CheckoutSummary } from './checkout-summary';
import { StepShell } from './step-shell';
import { InformationStep } from './information-step';
import { DeliveryStep } from './delivery-step';
import { PaymentStep } from './payment-step';
import { ReviewStep } from './review-step';
import { EmptyCheckout } from './empty-checkout';

const ORDER: CheckoutStepId[] = CHECKOUT_STEPS.map((s) => s.id);

function nextOf(step: CheckoutStepId): CheckoutStepId | null {
  return ORDER[ORDER.indexOf(step) + 1] ?? null;
}
function previousOf(step: CheckoutStepId): CheckoutStepId | null {
  return ORDER[ORDER.indexOf(step) - 1] ?? null;
}

/** Which step owns the first thing that failed, so we can send them there. */
function stepForField(path: string): CheckoutStepId {
  if (path.startsWith('contact') || path.startsWith('address')) return 'information';
  if (path.startsWith('deliveryMethodId')) return 'delivery';
  if (path.startsWith('paymentMethodId')) return 'payment';
  return 'review';
}

export function CheckoutView({
  config,
  account,
}: {
  config: CheckoutConfig;
  /** null for a guest — checkout works exactly the same either way */
  account: CheckoutAccount | null;
}) {
  const router = useRouter();
  const { org } = useStorefront();

  const savedAddresses = account?.addresses ?? [];

  /*
   * Which saved address the order is going to, or USE_NEW_ADDRESS.
   *
   * Held here rather than in the checkout store because it is a view
   * concern: the store only ever holds the address ITSELF, so an order never
   * depends on a book entry that might have been edited or deleted between
   * choosing it and placing the order.
   */
  const [selectedAddressId, setSelectedAddressId] = React.useState<string>(
    savedAddresses[0]?.id ?? USE_NEW_ADDRESS,
  );
  const [saveAddress, setSaveAddress] = React.useState(savedAddresses.length === 0);

  const hydrated = useCartStore((s) => s.hydrated);
  const items = useCartStore((s) => s.items);
  /* The discount code belongs to the bag, like the lines. Checkout shows
   * what it takes off and sends the CODE with the order; the server decides
   * all over again whether it may be used. */
  const coupon = useCartStore((s) => s.coupon);

  const step = useCheckoutStore((s) => s.step);
  const furthestStep = useCheckoutStore((s) => s.furthestStep);
  const status = useCheckoutStore((s) => s.status);
  const failure = useCheckoutStore((s) => s.failure);
  const payingOnline = useCheckoutStore((s) => Boolean(s.placed?.paymentUrl));
  const deliveryMethodId = useCheckoutStore((s) => s.deliveryMethodId);
  const setStep = useCheckoutStore((s) => s.setStep);

  /* The bag is checked against the catalogue here as well as on /cart: this
   * is the last moment before an order, and a line that sold out in the
   * meantime has to be caught now rather than "confirmed" and apologised
   * for later. Same hook, same endpoint — checkout adds no second mechanism. */
  const { notices } = useCartReconciliation();


  /* Read the store ONCE for the form's starting values — subscribing here
   * would make every keystroke a re-render of the whole checkout. */
  const defaultValues = React.useMemo<CheckoutFormValues>(() => {
    const draft = useCheckoutStore.getState();

    /* A signed-in shopper starts from what we already know: their contact
     * details, and their default address. A draft they were part-way
     * through always wins — being "helpfully" reset to your saved address
     * after typing a different one is worse than no prefill at all. */
    const seededContact =
      draft.contact.email || !account
        ? draft.contact
        : { ...draft.contact, ...account.contact };

    /* "Has the shopper typed an address?" is judged on the street line, not
     * on the country: `initialize` seeds a default country into an otherwise
     * empty draft, so a country alone proves nothing. */
    const draftStarted = Boolean(draft.address.addressLine1);
    const savedDefault = account?.addresses[0];
    const seededAddress = draftStarted
      ? draft.address
      : savedDefault
        ? fromStoredAddress(savedDefault, config)
        : draft.address.country
          ? draft.address
          : emptyAddress(config.defaultCountryCode);

    return {
      contact: seededContact,
      address: seededAddress,
      deliveryMethodId: draft.deliveryMethodId ?? config.defaultDeliveryMethodId ?? '',
      paymentMethodId: draft.paymentMethodId ?? '',
      orderNote: draft.orderNote,
    };
  }, [config, account]);

  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutSchema(config)),
    /* onTouched, not onChange: telling someone their email is invalid while
     * they are still on the second character is nagging, not help. */
    mode: 'onTouched',
    defaultValues,
  });

  /* ---------------- delivery, quoted for the address ----------------
   *
   * What delivery costs depends on where it's going, so the options come
   * from the server (the merchant's zones) for the address on the form. They
   * are fetched once the shopper is past their details, and again whenever
   * the state, city or bag total changes — a free-delivery threshold can
   * flip with the bag. The demo fixtures carry a fixed list, used as-is. */
  const fixedOptions = config.deliveryMethods;
  const [quote, setQuote] = React.useState<{
    status: 'idle' | 'loading' | 'ready' | 'error';
    options: ShippingMethod[];
    zoneName: string | null;
    message: string | null;
  }>({ status: fixedOptions.length ? 'ready' : 'idle', options: fixedOptions, zoneName: null, message: null });

  const [quoteState, quoteCity] = useWatch({ control: form.control, name: ['address.state', 'address.city'] });
  const pastDetails = step !== 'information';
  const subtotalForQuote = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const quoteAttempt = React.useRef(0);

  const requestQuote = React.useCallback(async () => {
    if (fixedOptions.length) return;
    const attempt = ++quoteAttempt.current;
    setQuote((q) => ({ ...q, status: 'loading', message: null }));
    try {
      const result = await quoteDeliveryAction({ state: quoteState ?? '', city: quoteCity ?? '', subtotal: subtotalForQuote });
      // A slower, older answer must not overwrite the one for the current address.
      if (attempt !== quoteAttempt.current) return;
      if (!result.ok) {
        setQuote({ status: 'error', options: [], zoneName: null, message: result.message });
        return;
      }
      setQuote({ status: 'ready', options: result.options, zoneName: result.zoneName, message: null });

      /* Keep the shopper's choice if it's still offered; otherwise preselect
       * the first (cheapest delivery) so the summary shows a real total. */
      const current = form.getValues('deliveryMethodId');
      const next = result.options.some((o) => o.id === current) ? current : (result.options[0]?.id ?? '');
      if (next !== current) {
        form.setValue('deliveryMethodId', next, { shouldValidate: false });
        useCheckoutStore.getState().setDeliveryMethod(next);
      }
    } catch {
      if (attempt !== quoteAttempt.current) return;
      setQuote({ status: 'error', options: [], zoneName: null, message: 'We couldn’t load delivery options just now. Please try again.' });
    }
  }, [fixedOptions.length, quoteState, quoteCity, subtotalForQuote, form]);

  React.useEffect(() => {
    if (pastDetails && hydrated) void requestQuote();
  }, [pastDetails, hydrated, requestQuote]);

  const deliveryOptions = quote.options;
  const deliveryMethod = deliveryOptions.find((m) => m.id === deliveryMethodId) ?? null;
  const totals = React.useMemo(
    () => calculateCheckoutTotals({ items, deliveryMethod, discount: coupon, config }),
    [items, deliveryMethod, coupon, config],
  );
  const itemCount = checkoutItemCount(items);

  /* A method the bag has ruled out must not survive as a stale choice: the
   * shopper may have picked pay on delivery and then added an item the
   * merchant wants paid up front. Clearing it sends them back to the step,
   * where the option is greyed out with the reason — better than an order
   * refused at the last moment. */
  const paymentMethodId = useWatch({ control: form.control, name: 'paymentMethodId' });
  React.useEffect(() => {
    if (!paymentMethodId) return;
    const method = config.paymentMethods.find((m) => m.id === paymentMethodId);
    if (method && !isPaymentMethodAllowed(method, items)) {
      form.setValue('paymentMethodId', '', { shouldValidate: false });
      useCheckoutStore.getState().setPaymentMethod('');
    }
  }, [paymentMethodId, config.paymentMethods, items, form]);

  React.useEffect(() => {
    const store = useCheckoutStore.getState();
    /* Arriving on checkout after an order was placed (a back-navigation)
     * starts a fresh one rather than showing a finished flow that cannot be
     * submitted again. */
    if (store.status === 'placed') store.reset(config);
    store.initialize(config);
  }, [config]);

  /* ---------------- committing form values to the store ---------------- */

  const commit = React.useCallback(
    (which: CheckoutStepId | 'all') => {
      const values = form.getValues();
      const store = useCheckoutStore.getState();

      if (which === 'information' || which === 'all') {
        store.setContact(values.contact);
        store.setAddress(values.address);
      }
      if (which === 'delivery' || which === 'all') {
        if (values.deliveryMethodId) store.setDeliveryMethod(values.deliveryMethodId);
      }
      if (which === 'payment' || which === 'all') {
        if (values.paymentMethodId) store.setPaymentMethod(values.paymentMethodId);
      }
      if (which === 'review' || which === 'all') {
        store.setOrderNote(values.orderNote ?? '');
      }
    },
    [form],
  );

  /*
   * Picking a saved address fills the form with it, rather than keeping a
   * parallel "chosen address" the rest of the flow would have to know about.
   * Everything downstream — validation, the review step, the order — keeps
   * reading exactly one address, the one in the form.
   */
  const selectAddress = React.useCallback(
    (id: string) => {
      setSelectedAddressId(id);
      if (id === USE_NEW_ADDRESS) {
        form.setValue('address', emptyAddress(config.defaultCountryCode), { shouldValidate: false });
        return;
      }
      const chosen = savedAddresses.find((a) => a.id === id);
      if (chosen) {
        form.setValue('address', fromStoredAddress(chosen, config), { shouldValidate: false });
        form.clearErrors('address');
      }
    },
    [config, form, savedAddresses],
  );

  const goTo = React.useCallback(
    (target: CheckoutStepId) => {
      setStep(target);
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [setStep],
  );

  /* ---------------- advancing ---------------- */

  const advance = async () => {
    /* The courier's name and phone come from the contact step rather than
     * being asked for twice — stamped in before validation so the address
     * the schema sees is the address the order will carry. */
    if (step === 'information') {
      const contact = form.getValues('contact');
      const address = form.getValues('address');
      if (!address.firstName) form.setValue('address.firstName', contact.firstName);
      if (!address.lastName) form.setValue('address.lastName', contact.lastName);
      if (!address.phone) form.setValue('address.phone', contact.phone);
    }

    const fields = STEP_FIELDS[step];
    const ok = fields.length === 0 || (await form.trigger([...fields], { shouldFocus: true }));
    if (!ok) return;

    commit(step);
    const next = nextOf(step);
    if (next) goTo(next);
  };

  /* ---------------- placing ---------------- */

  const place = async () => {
    /* Guarded here as well as by the disabled button and by the store: a
     * double-tap on a slow connection fires this twice. */
    if (status === 'submitting' || status === 'placed') return;

    const valid = await form.trigger(undefined, { shouldFocus: true });
    if (!valid) {
      const firstPath = Object.keys(form.formState.errors)[0];
      const owner = firstPath ? stepForField(firstPath) : 'information';
      if (owner !== step) goTo(owner);
      return;
    }

    commit('all');

    const result = await useCheckoutStore.getState().placeOrder({ config, tenantId: org.slug, deliveryOptions });
    if (result.ok) {
      /* Saved AFTER the order, never before: the order is what matters, and
       * an address book write must not be able to fail a checkout. Errors
       * are swallowed for the same reason (see the action's own note). */
      if (account && saveAddress && selectedAddressId === USE_NEW_ADDRESS) {
        void saveCheckoutAddressAction(toStoredAddress(form.getValues('address'), config)).catch(
          () => {},
        );
      }

      /* Paying happens on Squad's page, a different origin, so this is a full
       * navigation. `replace` either way: the shopper must not be able to
       * reach a submitted checkout with the Back button. Squad returns them
       * to the confirmation; if payment couldn't be started, they go there
       * directly and it offers "Pay now".
       *
       * The token, not the reference: the reference is sequential, and a
       * confirmation page that opened on one would open on all of them. */
      if (result.paymentUrl) {
        void openPaymentPage({
          paymentUrl: result.paymentUrl,
          confirmationPath: result.confirmationPath,
          replace: true,
        });
      } else {
        router.replace(`/checkout/confirmation?t=${encodeURIComponent(result.confirmationToken)}`);
      }
    } else {
      toast.error(result.message);
    }
  };

  /* ---------------- render ---------------- */

  if (!hydrated) return <CheckoutSkeleton />;

  /* `placed` still renders while the router moves to the confirmation —
   * without it the now-empty bag would flash the empty state on the way. */
  if (items.length === 0 && status !== 'placed' && status !== 'submitting') {
    return <EmptyCheckout />;
  }

  /* The merchant hasn't set up any delivery or pickup yet: there is nothing
   * to quote, so say so before the shopper types an address for nothing. */
  if (!config.deliveryAvailable && status !== 'placed') {
    return (
      <div role="status" className="mx-auto max-w-md rounded-2xl border bg-card px-6 py-12 text-center">
        <p className="font-display text-xl">Checkout isn’t open yet</p>
        <p className="mt-2 text-sm text-muted-foreground">
          This store hasn’t set up delivery or pickup, so orders can’t be placed right now. Your bag is saved —
          please check back soon.
        </p>
        <Link
          href="/cart"
          className="mt-6 inline-flex h-11 items-center rounded-full border px-6 text-sm font-semibold transition-colors hover:border-brand hover:text-brand"
        >
          Back to your bag
        </Link>
      </div>
    );
  }

  if (status === 'placed') {
    return (
      <div role="status" className="mx-auto max-w-md py-20 text-center">
        <p className="font-display text-xl">Order placed</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {payingOnline
            ? 'Taking you to the secure payment page…'
            : 'Taking you to your confirmation…'}
        </p>
      </div>
    );
  }

  const busy = status === 'submitting';
  const isReview = step === 'review';
  const back = previousOf(step);

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-12">
      <div className="min-w-0">
        <div className="mb-7">
          <CheckoutProgress current={step} furthest={furthestStep} onSelect={goTo} />
        </div>

        {/* Summary sits above the form on a phone, collapsed — the total is
         * reachable without pushing the first field off the screen. */}
        <div className="mb-6 lg:hidden">
          <CheckoutSummary
            items={items}
            totals={totals}
            deliveryMethod={deliveryMethod}
            coupon={coupon}
            config={config}
            itemCount={itemCount}
          />
        </div>

        {notices.length > 0 && (
          <div
            role="status"
            className="mb-6 rounded-xl border border-sale/30 bg-sale/5 p-4 text-sm"
          >
            <p className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="size-4 text-sale" aria-hidden />
              Your bag changed before you got here
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6 text-muted-foreground">
              {notices.map((notice) => (
                <li key={`${notice.kind}:${notice.key}`}>{describeNotice(notice)}</li>
              ))}
            </ul>
            <Link href="/cart" className="mt-2.5 inline-block font-semibold text-brand hover:underline">
              Review your bag
            </Link>
          </div>
        )}

        {/* One <form>, mounted for the whole flow. `onSubmit` is wired so
         * Enter in a text field advances the step instead of doing nothing —
         * and never places the order by accident. */}
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!isReview) void advance();
          }}
        >
          {step === 'information' && (
            <StepShell
              id="step-information"
              title="Your details"
              description="No account needed — we’ll email your receipt and tracking."
              onNext={advance}
              nextLabel="Continue to delivery"
            >
              <InformationStep
                form={form}
                config={config}
                signedIn={Boolean(account)}
                savedAddresses={savedAddresses}
                selectedAddressId={selectedAddressId}
                onSelectAddress={selectAddress}
                saveAddress={saveAddress}
                onToggleSaveAddress={setSaveAddress}
              />
            </StepShell>
          )}

          {step === 'delivery' && (
            <StepShell
              id="step-delivery"
              title="Delivery"
              description="How should we get this to you?"
              onBack={() => back && goTo(back)}
              backLabel="Your details"
              onNext={advance}
              nextLabel="Continue to payment"
            >
              <DeliveryStep
                form={form}
                options={deliveryOptions}
                status={quote.status}
                zoneName={quote.zoneName}
                errorMessage={quote.message}
                addressLabel={[quoteCity, quoteState].filter(Boolean).join(', ')}
                onRetry={() => void requestQuote()}
                onChangeAddress={() => goTo('information')}
                currency={totals.currency}
                onSelect={(id) => useCheckoutStore.getState().setDeliveryMethod(id)}
              />
            </StepShell>
          )}

          {step === 'payment' && (
            <StepShell
              id="step-payment"
              title="Payment"
              description="Choose how you’d like to pay. Nothing is charged until you place your order."
              onBack={() => back && goTo(back)}
              backLabel="Delivery"
              onNext={advance}
              nextLabel="Review your order"
            >
              <PaymentStep
                form={form}
                config={config}
                items={items}
                onSelect={(id) => useCheckoutStore.getState().setPaymentMethod(id)}
              />
            </StepShell>
          )}

          {isReview && (
            <StepShell
              id="step-review"
              title="Review your order"
              description="Check everything over — you can still change any of it."
              onBack={() => back && goTo(back)}
              backLabel="Payment"
              onNext={place}
              nextLabel={busy ? 'Placing your order…' : 'Place order'}
              busy={busy}
              error={failure?.message ?? null}
              footerNote={
                <span>
                  You’re placing an order for{' '}
                  <strong className="font-semibold text-foreground">
                    {formatMoney(totals.total, totals.currency)}
                  </strong>
                  .
                </span>
              }
            >
              {failure?.code === 'invalid-discount' && coupon && (
                /* The order was refused over the code, so the way out is
                 * here rather than back in the bag: one tap, then place it
                 * again at full price. */
                <div
                  role="status"
                  className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sale/30 bg-sale/5 px-4 py-3 text-sm"
                >
                  <span>
                    Code <span className="font-mono font-semibold uppercase">{coupon.code}</span> can’t be
                    used on this order.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      useCartStore.getState().removeCoupon();
                      useCheckoutStore.getState().clearFailure();
                    }}
                    className="shrink-0 font-semibold text-brand hover:underline"
                  >
                    Remove code
                  </button>
                </div>
              )}

              <ReviewStep
                form={form}
                config={config}
                items={items}
                totals={totals}
                deliveryMethod={deliveryMethod}
                onEdit={goTo}
                onNoteChange={(note) => useCheckoutStore.getState().setOrderNote(note)}
              />
            </StepShell>
          )}
        </form>
      </div>

      <div className="hidden lg:block">
        <CheckoutSummary
          items={items}
          totals={totals}
          deliveryMethod={deliveryMethod}
          coupon={coupon}
          config={config}
          itemCount={itemCount}
        />
      </div>
    </div>
  );
}

function CheckoutSkeleton() {
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-12">
      <div className="space-y-5">
        <Skeleton className="h-5 w-52" />
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
        </div>
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 w-44 rounded-full" />
      </div>
      <Skeleton className="hidden h-80 rounded-2xl lg:block" />
    </div>
  );
}
