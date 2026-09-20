/*
 * lib/billing/checkout.ts
 *
 * Shared core for both checkout entry points:
 *  - features/billing/actions.ts's createCheckoutSession (plan + optional domain)
 *  - features/domains/actions.ts's purchaseDomain (domain only, for an
 *    already-paid org changing/adding a domain later from Settings -> Billing)
 *
 * Always initializes a single flat one-time Paystack charge (subscription
 * amount + optional one-time domain fee, no Paystack `plan` param — see
 * createSubscription() in lib/billing/paystack.ts for why recurring billing
 * is set up separately, after a successful charge, not via this transaction).
 */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { amountForPlan, ensurePaystackPlan, initializeTransaction } from '@/lib/billing/paystack';
import { normalizeDomain, searchDomain } from '@/lib/domains/namecheap';
import { quoteDomainNgn } from '@/lib/domains/pricing';
import { notifyPendingDomainOrder } from '@/lib/domains/notify';
import type { OrganizationPlan, BillingCycle, DomainOrderType, DomainOrderStatus } from '@/lib/generated/prisma/enums';

/** User-facing checkout validation failures — safe to show the message directly. */
export class CheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckoutError';
  }
}

export type DomainChoiceInput =
  | { type: 'FREE' }
  | { type: 'EXISTING'; domain: string }
  | { type: 'REGISTER'; domain: string };

type DomainOrderInsert = {
  type: DomainOrderType;
  domain: string | null;
  status: DomainOrderStatus;
  usdPrice: number | null;
  ngnPrice: number | null;
  exchangeRate: number | null;
};

async function resolveDomainOrder(
  choice: DomainChoiceInput | undefined,
): Promise<{ domainOrder: DomainOrderInsert | null; domainFeeNgn: number }> {
  if (!choice) return { domainOrder: null, domainFeeNgn: 0 };

  if (choice.type === 'FREE') {
    // Nothing to fulfill — the org's {slug}.{ROOT_DOMAIN} subdomain already
    // works via existing tenant routing. Recorded as ACTIVE immediately so
    // it never shows up in a fulfillment queue or triggers a notification.
    return {
      domainOrder: { type: 'FREE', domain: null, status: 'ACTIVE', usdPrice: null, ngnPrice: null, exchangeRate: null },
      domainFeeNgn: 0,
    };
  }

  if (choice.type === 'EXISTING') {
    const domain = normalizeDomain(choice.domain);
    return {
      domainOrder: { type: 'EXISTING', domain, status: 'PENDING_FULFILLMENT', usdPrice: null, ngnPrice: null, exchangeRate: null },
      domainFeeNgn: 0,
    };
  }

  // REGISTER — re-quote server-side right before charging. Never trust a
  // client-supplied price: it may be stale (TLD price changed) or tampered.
  const result = await searchDomain(choice.domain);
  if (!result.available) {
    throw new CheckoutError(`${result.domain} is no longer available — please search again.`);
  }
  const quote = await quoteDomainNgn(result.priceUsd);

  return {
    domainOrder: {
      type: 'REGISTER',
      domain: result.domain,
      status: 'PENDING_FULFILLMENT',
      usdPrice: quote.usdPrice,
      ngnPrice: quote.ngnPrice,
      exchangeRate: quote.exchangeRate,
    },
    domainFeeNgn: quote.ngnPrice,
  };
}

export type CheckoutResult =
  | { requiresPayment: true; authorizationUrl: string }
  | { requiresPayment: false };

export async function buildAndInitializeCheckout(params: {
  organizationId: string;
  organizationSlug: string;
  userId: string;
  userEmail: string;
  plan?: OrganizationPlan;
  billingCycle?: BillingCycle;
  domainChoice?: DomainChoiceInput;
}): Promise<CheckoutResult> {
  const isPlanChange = !!params.plan;
  let plan = params.plan;
  let billingCycle = params.billingCycle;

  if (!plan) {
    // No plan change requested — this must be a domain-only purchase for an
    // org that's already on a paid plan. Reuse their current plan/cycle so
    // the (required) BillingTransaction.plan/billingCycle fields stay
    // populated without actually changing anything.
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId: params.organizationId },
    });
    if (!subscription || subscription.plan === 'FREE') {
      throw new CheckoutError('An active paid subscription is required to purchase a custom domain.');
    }
    plan = subscription.plan;
    billingCycle = subscription.billingCycle;
  }

  if (!billingCycle) {
    throw new CheckoutError('billingCycle is required when changing plans.');
  }

  const subscriptionAmount = params.plan ? amountForPlan(plan, billingCycle) : 0;
  const { domainOrder, domainFeeNgn } = await resolveDomainOrder(params.domainChoice);
  const totalAmount = subscriptionAmount + domainFeeNgn;

  if (totalAmount <= 0) {
    if (!domainOrder) {
      throw new CheckoutError('Nothing to charge — choose a plan or a domain to purchase.');
    }
    // A zero-fee domain order (EXISTING) with no plan change bundled in —
    // e.g. "connect a domain I already own" from Settings -> Billing on its
    // own. Nothing to charge, so skip Paystack entirely: record the order
    // (unlinked to any BillingTransaction) and notify immediately.
    await prisma.domainOrder.create({
      data: { organizationId: params.organizationId, ...domainOrder },
    });
    if (domainOrder.status === 'PENDING_FULFILLMENT') {
      await notifyPendingDomainOrder(params.organizationId, {
        type: domainOrder.type as 'EXISTING' | 'REGISTER',
        domain: domainOrder.domain,
      });
    }
    return { requiresPayment: false };
  }

  // Fail fast (before charging) if the Paystack Plan object can't be created
  // — createSubscription() will need this code once the charge succeeds.
  await ensurePaystackPlan(plan, billingCycle);

  const reference = `mansaas_${params.organizationId}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const { authorizationUrl } = await initializeTransaction({
    email: params.userEmail,
    amountNaira: totalAmount,
    reference,
    callbackUrl: `${appBaseUrl}/api/billing/paystack/callback`,
    metadata: {
      organizationId: params.organizationId,
      organizationSlug: params.organizationSlug,
      plan,
      billingCycle,
      userId: params.userId,
      hasDomainOrder: !!domainOrder,
    },
  });

  await prisma.$transaction(async (tx) => {
    const billingTransaction = await tx.billingTransaction.create({
      data: {
        organizationId: params.organizationId,
        reference,
        type: 'CHECKOUT',
        status: 'PENDING',
        plan,
        billingCycle,
        amount: totalAmount,
        currency: 'NGN',
        isPlanChange,
      },
    });

    if (domainOrder) {
      await tx.domainOrder.create({
        data: {
          organizationId: params.organizationId,
          billingTransactionId: billingTransaction.id,
          ...domainOrder,
        },
      });
    }
  });

  return { requiresPayment: true, authorizationUrl };
}
