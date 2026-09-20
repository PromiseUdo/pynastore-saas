/*
 * lib/billing/paystack.ts
 *
 * Thin server-only client for the Paystack API. Never import from a
 * client component — uses PAYSTACK_SECRET_KEY.
 */
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { PLANS, getYearlyPrice } from '@/lib/billing/plans';
import type { OrganizationPlan } from '@/lib/generated/prisma/enums';
import type { BillingCycle } from '@/lib/generated/prisma/enums';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not configured.');
  return key;
}

async function paystackFetch<T = any>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  const body = await res.json();
  if (!res.ok || body.status === false) {
    throw new Error(body.message ?? `Paystack request failed: ${path}`);
  }
  return body;
}

/** Amount in NGN major units -> kobo (Paystack works in the lowest currency unit). */
function toKobo(amountNaira: number): number {
  return Math.round(amountNaira * 100);
}

export function amountForPlan(plan: OrganizationPlan, billingCycle: BillingCycle): number {
  const { monthlyPrice } = PLANS[plan];
  return billingCycle === 'YEARLY' ? getYearlyPrice(monthlyPrice) : monthlyPrice;
}

/**
 * Ensures a Paystack Plan object exists for the given (plan, billingCycle)
 * pair, creating it on first use and caching the code in BillingPlanCode.
 */
export async function ensurePaystackPlan(
  plan: OrganizationPlan,
  billingCycle: BillingCycle,
): Promise<string> {
  const existing = await prisma.billingPlanCode.findUnique({
    where: { plan_billingCycle: { plan, billingCycle } },
  });
  if (existing) return existing.paystackPlanCode;

  const amount = amountForPlan(plan, billingCycle);
  const planConfig = PLANS[plan];

  const created = await paystackFetch<{ data: { plan_code: string } }>('/plan', {
    method: 'POST',
    body: JSON.stringify({
      name: `MansaaS ${planConfig.name} (${billingCycle === 'YEARLY' ? 'Yearly' : 'Monthly'})`,
      amount: toKobo(amount),
      interval: billingCycle === 'YEARLY' ? 'annually' : 'monthly',
      currency: 'NGN',
    }),
  });

  const paystackPlanCode = created.data.plan_code;

  await prisma.billingPlanCode.upsert({
    where: { plan_billingCycle: { plan, billingCycle } },
    create: { plan, billingCycle, paystackPlanCode },
    update: { paystackPlanCode },
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

/** Verifies the `x-paystack-signature` header against the raw request body. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const hash = crypto.createHmac('sha512', secretKey()).update(rawBody).digest('hex');
  return hash === signature;
}
