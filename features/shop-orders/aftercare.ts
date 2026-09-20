'use server';

/*
 * features/shop-orders/aftercare.ts
 *
 * What a signed-in shopper can do with an order after placing it: cancel it
 * before packing, ask to send items back, and withdraw a return request the
 * store hasn't answered.
 *
 * The store and the shopper come from the request and the session cookie,
 * never the form. Every order is found WITH the shopper's customer id, so a
 * reference typed into a doctored form reaches nobody else's order. What is
 * allowed — the packing cut-off, the return window, what's left of a line —
 * is decided again in lib/storefront/orders/, not taken from the page.
 *
 * Guests act by signing in: a guest order belongs to the customer record for
 * its email (lib/storefront/orders/create.ts), so registering with that email
 * brings the order into their account.
 */
import { checkRateLimit } from '@/lib/rate-limit';
import { getShopper } from '@/lib/storefront/account/session';
import { cancelOrderForCustomer } from '@/lib/storefront/orders/lifecycle';
import { requestReturn, withdrawReturn } from '@/lib/storefront/orders/returns';
import type { ReturnLineRequest } from '@/lib/storefront/orders/policy';

export type AftercareResult = { ok: true } | { ok: false; message: string };

const SIGNED_OUT: AftercareResult = { ok: false, message: 'Your session has ended. Please sign in again.' };
const TOO_MANY: AftercareResult = { ok: false, message: 'Too many attempts. Please wait a moment and try again.' };

export async function cancelMyOrderAction(input: { reference: string; note?: string }): Promise<AftercareResult> {
  const shopper = await getShopper();
  if (!shopper) return SIGNED_OUT;
  if (!checkRateLimit(`cancel-order:${shopper.id}`, 10, 10 * 60 * 1000)) return TOO_MANY;

  try {
    const result = await cancelOrderForCustomer({
      organizationId: shopper.organizationId,
      customerId: shopper.id,
      reference: String(input.reference ?? ''),
      note: typeof input.note === 'string' ? input.note : null,
    });
    return result.ok ? { ok: true } : { ok: false, message: result.error };
  } catch (error) {
    console.error('[orders] A shopper could not cancel their order:', error);
    return { ok: false, message: 'We couldn’t cancel your order just now. Please try again.' };
  }
}

export async function requestReturnAction(input: {
  reference: string;
  lines: ReturnLineRequest[];
  reason: string;
  details?: string;
}): Promise<AftercareResult> {
  const shopper = await getShopper();
  if (!shopper) return SIGNED_OUT;
  if (!checkRateLimit(`request-return:${shopper.id}`, 10, 60 * 60 * 1000)) return TOO_MANY;

  try {
    const result = await requestReturn({
      organizationId: shopper.organizationId,
      customerId: shopper.id,
      reference: String(input.reference ?? ''),
      lines: Array.isArray(input.lines)
        ? input.lines.slice(0, 100).map((line) => ({
            orderLineItemId: String(line?.orderLineItemId ?? ''),
            quantity: Number(line?.quantity),
          }))
        : [],
      reason: String(input.reason ?? ''),
      details: typeof input.details === 'string' ? input.details : null,
    });
    return result.ok ? { ok: true } : { ok: false, message: result.error };
  } catch (error) {
    console.error('[orders] A shopper could not request a return:', error);
    return { ok: false, message: 'We couldn’t send your request just now. Please try again.' };
  }
}

export async function withdrawReturnAction(input: { returnId: string }): Promise<AftercareResult> {
  const shopper = await getShopper();
  if (!shopper) return SIGNED_OUT;
  if (!checkRateLimit(`withdraw-return:${shopper.id}`, 20, 10 * 60 * 1000)) return TOO_MANY;

  try {
    const result = await withdrawReturn({
      organizationId: shopper.organizationId,
      customerId: shopper.id,
      returnId: String(input.returnId ?? ''),
    });
    return result.ok ? { ok: true } : { ok: false, message: result.error };
  } catch (error) {
    console.error('[orders] A shopper could not withdraw a return:', error);
    return { ok: false, message: 'We couldn’t withdraw your request just now. Please try again.' };
  }
}
