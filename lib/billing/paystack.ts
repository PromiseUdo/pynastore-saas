/*
 * lib/billing/paystack.ts
 *
 * Subscription billing on the Paystack API. Never import from a client
 * component — uses PAYSTACK_SECRET_KEY. Requests go through the shared
 * client in lib/payments/paystack.ts.
 */
import { prisma } from '@/lib/prisma';
import { paystackFetch, verifyPaystackSignature } from '@/lib/payments/paystack';
import { PLATFORM_NAME } from '@/lib/brand';
import { CYCLES, type BillingCycleKey } from '@/lib/billing/plans';

/** Amount in NGN major units -> kobo (Paystack works in the lowest currency unit). */
function toKobo(amountNaira: number): number {
  return Math.round(amountNaira * 100);
}

/**
 * The Paystack Plan object for one plan, cycle AND price, creating it on first
 * use (ROADMAP 12.1). Keyed by the price, not just the plan: when staff change
 * a price, the next subscriber gets a new Paystack plan, while everyone
 * subscribed at the old price keeps renewing at it.
 */
export async function ensurePaystackPlan(input: {
  planId: string;
  planName: string;
  billingCycle: BillingCycleKey;
  /** NGN, major units — what this cycle costs */
  amount: number;
}): Promise<string> {
  const amount = toKobo(input.amount);
  const existing = await prisma.billingPlanCode.findUnique({
    where: { planId_billingCycle_amount: { planId: input.planId, billingCycle: input.billingCycle, amount } },
  });
  if (existing) return existing.paystackPlanCode;

  const cycle = CYCLES[input.billingCycle];
  const created = await paystackFetch<{ data: { plan_code: string } }>('/plan', {
    method: 'POST',
    body: JSON.stringify({
      name: `${PLATFORM_NAME} ${input.planName} (${cycle.label})`,
      amount,
      interval: cycle.paystackInterval,
      currency: 'NGN',
    }),
  });

  const paystackPlanCode = created.data.plan_code;
  await prisma.billingPlanCode.upsert({
    where: { planId_billingCycle_amount: { planId: input.planId, billingCycle: input.billingCycle, amount } },
    create: { planId: input.planId, billingCycle: input.billingCycle, amount, paystackPlanCode },
    update: {},
  });
  return paystackPlanCode;
}

export async function initializeTransaction(params: {
  email: string;
  amountNaira: number;
  reference: string;
  callbackUrl: string;
  paystackPlanCode?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ authorizationUrl: string; accessCode: string; reference: string }> {
  const res = await paystackFetch<{
    data: { authorization_url: string; access_code: string; reference: string };
  }>('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: params.email,
      amount: toKobo(params.amountNaira),
      reference: params.reference,
      callback_url: params.callbackUrl,
      plan: params.paystackPlanCode,
      currency: 'NGN',
      metadata: params.metadata,
    }),
  });

  return {
    authorizationUrl: res.data.authorization_url,
    accessCode: res.data.access_code,
    reference: res.data.reference,
  };
}

export type PaystackChargeData = {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  customer: { customer_code: string; email: string };
  authorization?: { authorization_code: string; reuse: boolean };
  plan?: { plan_code?: string } | string | null;
  metadata?: Record<string, unknown>;
};

export async function verifyTransaction(reference: string): Promise<PaystackChargeData> {
  const res = await paystackFetch<{ data: PaystackChargeData }>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
  return res.data;
}

export async function disableSubscription(
  subscriptionCode: string,
  emailToken: string,
): Promise<void> {
  await paystackFetch('/subscription/disable', {
    method: 'POST',
    body: JSON.stringify({ code: subscriptionCode, token: emailToken }),
  });
}

/**
 * Sets up recurring billing at the PLAN's own amount, decoupled from
 * whatever the customer was actually charged in the one-time transaction
 * that produced `authorizationCode` (which may include a one-time add-on
 * fee, e.g. a domain registration — see lib/billing/checkout.ts). Paystack
 * still fires a `subscription.create` webhook for the subscription created
 * here, which is what actually persists paystackSubscriptionCode/
 * paystackEmailToken (see app/api/billing/paystack/webhook/route.ts).
 */
export async function createSubscription(params: {
  customerEmail: string;
  paystackPlanCode: string;
  authorizationCode: string;
}): Promise<void> {
  await paystackFetch('/subscription', {
    method: 'POST',
    body: JSON.stringify({
      customer: params.customerEmail,
      plan: params.paystackPlanCode,
      authorization: params.authorizationCode,
    }),
  });
}

/**
 * Verifies the `x-paystack-signature` header against the raw request body —
 * in constant time, through the shared client (ROADMAP 10.5).
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  return verifyPaystackSignature(rawBody, signature);
}
