'use client';

/*
 * "Track your order" — for someone without an account.
 *
 * Reference AND email, both. The reference alone counts upwards, so it would
 * be guessable; the email is what proves the order is yours to look at. A
 * wrong email and a missing order give the SAME answer, so this form can't
 * be used to find out which references exist.
 *
 * On success the order is shown right here rather than redirected to, so the
 * URL never carries the reference and nothing lands in browser history that
 * a shared laptop would give away.
 */
import { useActionState } from 'react';
import Link from 'next/link';
import { Search, TriangleAlert } from 'lucide-react';
import { findOrderAction } from '@/features/shop-orders/actions';
import { TextField } from '@/components/storefront/checkout/checkout-fields';
import type { StorefrontOrder } from '@/lib/storefront/orders/types';
import { OrderDetail } from './order-detail';

type State = { order?: StorefrontOrder; error?: string; values?: { reference?: string; email?: string } } | null;

export function TrackOrderForm({ locale }: { locale: string }) {
  const [state, action, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    const reference = String(formData.get('reference') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim();
    const values = { reference, email };

    if (!reference || !email) {
      return { error: 'Enter both your order number and the email you used.', values };
    }

    const order = await findOrderAction({ reference, email });

    if (!order) {
      return {
        error:
          'We can’t find an order with that number and email. Check the confirmation email — the number looks like ORD-2026-000123.',
        values,
      };
    }

    return { order };
  }, null);

  if (state?.order) {
    return (
      <div className="space-y-5">
        <OrderDetail order={state.order} locale={locale} />
        <p className="text-center text-sm text-muted-foreground">
          <Link
            href="/account/register"
            className="font-semibold text-brand underline underline-offset-4"
          >
            Create an account
          </Link>{' '}
          and your orders are here without the order number.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      {state?.error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {state.error}
        </p>
      )}

      <TextField
        id="track-reference"
        name="reference"
        label="Order number"
        placeholder="ORD-2026-000123"
        autoCapitalize="characters"
        spellCheck={false}
        hint="It's at the top of your confirmation email."
        defaultValue={state?.values?.reference}
        required
      />

      <TextField
        id="track-email"
        name="email"
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        hint="The address you ordered with."
        defaultValue={state?.values?.email}
        required
      />

      <button
        type="submit"
        disabled={pending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand text-base font-semibold text-primary-foreground transition-colors hover:bg-brand-hover disabled:opacity-60"
      >
        <Search className="size-4" aria-hidden />
        {pending ? 'Looking…' : 'Find my order'}
      </button>
    </form>
  );
}
