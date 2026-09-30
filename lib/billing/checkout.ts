/*
 * lib/billing/checkout.ts
 *
 * Shared core for both checkout entry points:
 *  - features/billing/actions.ts's createCheckoutSession (plan + optional domain)
 *  - features/domains/actions.ts (a domain only — buying or renewing one from
 *    Settings → Domain, which needs a paid plan)
 *
 * Always initializes a single flat one-time Paystack charge (subscription
 * amount + optional one-time domain fee, no Paystack `plan` param — see
 * createSubscription() in lib/billing/paystack.ts for why recurring billing
 * is set up separately, after a successful charge, not via this transaction).
 */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { ensurePaystackPlan, initializeTransaction } from '@/lib/billing/paystack';
import { priceForCheckout } from '@/lib/billing/catalogue';
import type { BillingCycleKey } from '@/lib/billing/plans';
import { getTldPriceUsd, searchDomain } from '@/lib/domains/namecheap';
import { quoteDomainNgn } from '@/lib/domains/pricing';
import { comDomain, renewalStage } from '@/lib/domains/rules';
import { domainHeldElsewhere } from '@/lib/domains/shop-domain';
import type { DomainOrderType, DomainOrderStatus } from '@/lib/generated/prisma/enums';

/** User-facing checkout validation failures — safe to show the message directly. */
export class CheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckoutError';
  }
}

/**
 * A domain bought through billing (ROADMAP 12.6): a new `.com`, or renewing
 * the shop's registered domain. Connecting a domain the merchant already
 * owns is free and isn't a checkout (features/domains/actions.ts).
 */
export type DomainChoiceInput = { type: 'REGISTER'; domain: string } | { type: 'RENEW' };

type DomainOrderInsert = {
  type: DomainOrderType;
  domain: string | null;
  status: DomainOrderStatus;
  usdPrice: number | null;
  ngnPrice: number | null;
  exchangeRate: number | null;
};

async function resolveDomainOrder(
  organizationId: string,
  choice: DomainChoiceInput | undefined,
): Promise<{ domainOrder: DomainOrderInsert | null; domainFeeNgn: number }> {
  if (!choice) return { domainOrder: null, domainFeeNgn: 0 };

  if (choice.type === 'RENEW') {
    const current = await prisma.shopDomain.findUnique({ where: { organizationId } });
    if (!current || current.source !== 'REGISTERED' || !current.expiresAt || !['LIVE', 'EXPIRED'].includes(current.status)) {
      throw new CheckoutError('There’s no domain registered through us to renew.');
    }
    const stage = renewalStage(current.expiresAt, new Date());
    if (stage === 'redemption' || stage === 'released') {
      throw new CheckoutError('This domain can’t be renewed at the normal price any more. Contact us about recovering it.');
    }
    const open = await prisma.domainOrder.findFirst({
      where: { organizationId, type: 'RENEW', status: 'PENDING_FULFILLMENT', billingTransaction: { status: 'SUCCESS' } },
      select: { id: true },
    });
    if (open) throw new CheckoutError('You’ve already renewed this domain — we’re completing it with the registrar.');
    const tld = current.hostname.split('.').slice(1).join('.');
    const quote = await quoteDomainNgn(await getTldPriceUsd(tld, 'renew'));
    return {
      domainOrder: { type: 'RENEW', domain: current.hostname, status: 'PENDING_FULFILLMENT', usdPrice: quote.usdPrice, ngnPrice: quote.ngnPrice, exchangeRate: quote.exchangeRate },
      domainFeeNgn: quote.ngnPrice,
    };
  }

  // REGISTER — `.com` only, not held by another shop, and re-quoted here
  // right before charging. Never trust a client-supplied price.
  const parsed = comDomain(choice.domain);
  if (!parsed.ok) throw new CheckoutError(parsed.error);
  const current = await prisma.shopDomain.findUnique({ where: { organizationId }, select: { status: true, hostname: true } });
  if (current && ['PENDING', 'LIVE'].includes(current.status)) {
    throw new CheckoutError(`Your shop already has ${current.hostname}. Remove it first to use a different domain.`);
  }
  if (await domainHeldElsewhere(parsed.domain, organizationId)) {
    throw new CheckoutError(`${parsed.domain} is already being set up for another shop.`);
  }
  const result = await searchDomain(parsed.domain);
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
  /** a catalogue plan id — omitted for a domain-only purchase */
  planId?: string;
  billingCycle?: BillingCycleKey;
  domainChoice?: DomainChoiceInput;
}): Promise<CheckoutResult> {
  const isPlanChange = !!params.planId;
  let planId: string;
  let planName: string;
  let billingCycle: BillingCycleKey;
  let subscriptionAmount = 0;

  if (params.planId) {
    if (!params.billingCycle) throw new CheckoutError('Choose how often to pay.');
    // The price is read here, at the moment of charging — never from the browser.
    const priced = await priceForCheckout(params.planId, params.billingCycle);
    if (!priced) throw new CheckoutError('That plan or billing option isn’t available any more. Choose again.');
    planId = priced.plan.id;
    planName = priced.plan.name;
    billingCycle = params.billingCycle;
    subscriptionAmount = priced.amount;
  } else {
    // No plan change — a domain-only purchase, which needs a PAID plan
    // (ROADMAP 12.6): not a trial, not a lapsed workspace. The charge is
    // recorded against the current plan so its history reads correctly.
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId: params.organizationId },
      select: { planId: true, billingCycle: true, status: true, plan: { select: { name: true } } },
    });
    if (!subscription?.planId || (subscription.status !== 'ACTIVE' && subscription.status !== 'PAST_DUE')) {
      throw new CheckoutError('A paid plan is needed to buy a custom domain. Choose a plan first.');
    }
    planId = subscription.planId;
    planName = subscription.plan?.name ?? '';
    billingCycle = subscription.billingCycle as BillingCycleKey;
  }

  const { domainOrder, domainFeeNgn } = await resolveDomainOrder(params.organizationId, params.domainChoice);
  const totalAmount = subscriptionAmount + domainFeeNgn;

  if (totalAmount <= 0) {
    throw new CheckoutError('Nothing to charge — choose a plan or a domain to purchase.');
  }

  // Fail fast (before charging) if the Paystack Plan object can't be created
  // — createSubscription() will need this code once the charge succeeds.
  if (isPlanChange) await ensurePaystackPlan({ planId, planName, billingCycle, amount: subscriptionAmount });

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
      planId,
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
        planId,
        planName,
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
