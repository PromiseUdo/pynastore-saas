/*
 * Plans, trials and lapsing (ROADMAP 12.1), against the real database.
 * Paystack is stubbed at `fetch`; nothing leaves the machine.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { dropBilling } from './helpers/plans';

vi.mock('@/lib/email', () => ({
  sendDomainOrderNotificationEmail: vi.fn(async () => {}),
}));
// Everything here goes by organisation id; no request context is needed.
vi.mock('@/lib/organization', () => ({
  getOrganizationContext: vi.fn(async () => {
    throw new Error('no request context in this test');
  }),
}));

const envWas = process.env.PAYSTACK_SECRET_KEY;
process.env.PAYSTACK_SECRET_KEY = 'sk_test_billing_plans_vitest';

const paystackPlans: { name: string; amount: number; interval: string }[] = [];
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url === 'https://api.paystack.co/plan' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body));
    paystackPlans.push(body);
    return new Response(JSON.stringify({ status: true, data: { plan_code: `PLN_test_${paystackPlans.length}_${suffix}` } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ status: false, message: `unexpected ${url}` }), { status: 500 });
});
vi.stubGlobal('fetch', fetchMock);

const { bootstrapOrganization } = await import('@/lib/onboarding/bootstrap');
const { entitlementsFor, storefrontIsOpen } = await import('@/lib/billing/entitlements');
const { applySuccessfulCharge } = await import('@/lib/billing/apply-charge');
const { ensurePaystackPlan } = await import('@/lib/billing/paystack');
const { priceForCheckout } = await import('@/lib/billing/catalogue');
const { getBillingSettings } = await import('@/lib/settings');
const { placeOrder } = await import('@/lib/storefront/orders/create');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DAY = 24 * 60 * 60 * 1000;
let ownerId = '';
const orgIds: string[] = [];
let testPlanId = '';

async function newWorkspace(n: number) {
  const { organization, start } = await bootstrapOrganization({
    name: `Billing ${n}`,
    slug: `__test-billing-${n}-${suffix}`,
    ownerUserId: ownerId,
  });
  orgIds.push(organization.id);
  // A new shop starts closed (ROADMAP 12.5); these tests are about the plan,
  // so open it — otherwise every order is refused as "not open yet".
  await prisma.organization.update({ where: { id: organization.id }, data: { storefrontOpen: true } });
  return { organization, start };
}

/** Ends the workspace's trial `daysAgo` days ago, with no lapse recorded yet. */
async function endTrial(organizationId: string, daysAgo: number) {
  await prisma.subscription.update({
    where: { organizationId },
    data: { status: 'TRIALING', trialEndsAt: new Date(Date.now() - daysAgo * DAY), lapsedAt: null, graceEndsAt: null },
  });
}

beforeAll(async () => {
  ownerId = (await prisma.user.create({ data: { email: `billing-owner-${suffix}@example.com` } })).id;
  testPlanId = (
    await prisma.billingPlan.create({
      data: {
        key: `__test-${suffix}`,
        name: 'Test plan',
        tagline: '',
        monthlyPrice: 5000,
        sortOrder: 99,
        isOnSale: true,
        maxSeats: 5,
        maxWarehouses: 1,
        prices: { create: [{ billingCycle: 'MONTHLY', discountPct: 0, amount: 5000 }] },
        features: { create: [{ feature: 'inventory.module' }, { feature: 'reports.advanced' }] },
      },
    })
  ).id;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  process.env.PAYSTACK_SECRET_KEY = envWas;
  for (const organizationId of orgIds) {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await dropBilling(organizationId);
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  await prisma.billingPlanCode.deleteMany({ where: { planId: testPlanId } });
  await prisma.billingPlan.delete({ where: { id: testPlanId } });
  await prisma.user.delete({ where: { id: ownerId } });
});

describe('a new workspace', () => {
  it('starts on a free trial of the configured plan, with no card', async () => {
    const settings = await getBillingSettings();
    const before = Date.now();
    const { organization, start } = await newWorkspace(1);

    expect(start.kind).toBe('trial');
    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { organizationId: organization.id },
      include: { plan: { select: { key: true } } },
    });
    expect(sub).toMatchObject({ status: 'TRIALING', paystackAuthorizationCode: null });
    expect(sub.plan?.key).toBe(settings.trialPlanKey);
    const expectedEnd = before + settings.trialDays * DAY;
    expect(Math.abs(sub.trialEndsAt!.getTime() - expectedEnd)).toBeLessThan(60_000);

    const { access, plan } = await entitlementsFor(organization.id);
    expect(access.state).toBe('trial');
    expect(plan.key).toBe(settings.trialPlanKey);
    expect(await storefrontIsOpen(organization.id)).toBe(true);
  });

  it('gets no second trial for the same owner — it opens on choosing a plan', async () => {
    const { organization, start } = await newWorkspace(2);
    expect(start.kind).toBe('no-trial');
    const { access, plan } = await entitlementsFor(organization.id);
    expect(access.state).toBe('lapsed');
    expect(plan.id).toBeNull();
    expect(await storefrontIsOpen(organization.id)).toBe(false);
  });
});

describe('when a trial ends', () => {
  it('records the lapse once, with its grace deadline fixed from then on', async () => {
    const organizationId = orgIds[0];
    const { graceDays } = await getBillingSettings();
    await endTrial(organizationId, 1);

    const first = await entitlementsFor(organizationId);
    expect(first.access.state).toBe(graceDays > 1 ? 'grace' : 'lapsed');
    const recorded = await prisma.subscription.findUniqueOrThrow({ where: { organizationId } });
    expect(recorded.lapsedAt).not.toBeNull();
    expect(recorded.graceEndsAt!.getTime() - recorded.lapsedAt!.getTime()).toBe(graceDays * DAY);

    // Asked again later: the same deadline, not a new one.
    await entitlementsFor(organizationId, new Date(Date.now() + DAY));
    const again = await prisma.subscription.findUniqueOrThrow({ where: { organizationId } });
    expect(again.graceEndsAt).toEqual(recorded.graceEndsAt);
  });

  it('keeps the shop selling through grace, then closes it and refuses orders', async () => {
    const organizationId = orgIds[0];
    const { graceDays } = await getBillingSettings();
    const slug = `__test-billing-1-${suffix}`;
    const order = () =>
      placeOrder({
        organizationSlug: slug,
        customerId: null,
        lines: [],
        contact: {} as never,
        address: {} as never,
        deliveryMethodId: '',
        paymentMethodId: '',
        note: '',
        config: {} as never,
      });

    if (graceDays > 1) {
      expect(await storefrontIsOpen(organizationId)).toBe(true);
      expect((await order()) as { code?: string }).toMatchObject({ ok: false, code: 'empty-cart' });
    }

    await endTrial(organizationId, graceDays + 1);
    expect((await entitlementsFor(organizationId)).access.state).toBe('lapsed');
    expect(await storefrontIsOpen(organizationId)).toBe(false);
    expect(await order()).toMatchObject({ ok: false, code: 'store-closed' });
  });

  it('reopens the moment a plan is paid for', async () => {
    const organizationId = orgIds[0];
    const reference = `bill_test_${suffix}`;
    await prisma.billingTransaction.create({
      data: {
        organizationId,
        reference,
        type: 'CHECKOUT',
        status: 'PENDING',
        planId: testPlanId,
        planName: 'Test plan',
        billingCycle: 'MONTHLY',
        amount: 5000,
        currency: 'NGN',
        isPlanChange: true,
      },
    });

    await applySuccessfulCharge({
      reference,
      status: 'success',
      amount: 500000,
      currency: 'NGN',
      customer: { customer_code: `CUS_${suffix}`, email: `billing-owner-${suffix}@example.com` },
    });

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId } });
    expect(sub).toMatchObject({ status: 'ACTIVE', planId: testPlanId, lapsedAt: null, graceEndsAt: null });
    expect(Number(sub.amount)).toBe(5000);
    const { access, plan } = await entitlementsFor(organizationId);
    expect(access.state).toBe('active');
    expect(plan.name).toBe('Test plan');
    expect(await storefrontIsOpen(organizationId)).toBe(true);
  });
});

describe('the catalogue', () => {
  it('takes a feature away on the next request when staff remove it', async () => {
    const organizationId = orgIds[0];
    expect((await entitlementsFor(organizationId)).plan.features).toContain('reports.advanced');
    await prisma.billingPlanFeature.delete({ where: { planId_feature: { planId: testPlanId, feature: 'reports.advanced' } } });
    expect((await entitlementsFor(organizationId)).plan.features).not.toContain('reports.advanced');
  });

  it('gives a new price its own Paystack plan and reuses one it already made', async () => {
    const at = (amount: number) => ensurePaystackPlan({ planId: testPlanId, planName: 'Test plan', billingCycle: 'MONTHLY', amount });
    const a = await at(5000);
    const b = await at(6000);
    const c = await at(5000);
    expect(a).not.toBe(b);
    expect(c).toBe(a);
    expect(paystackPlans.map((p) => [p.amount, p.interval])).toEqual([
      [500000, 'monthly'],
      [600000, 'monthly'],
    ]);
  });

  it('stops selling a retired plan but keeps its subscribers on it', async () => {
    expect(await priceForCheckout(testPlanId, 'MONTHLY')).not.toBeNull();
    await prisma.billingPlan.update({ where: { id: testPlanId }, data: { isOnSale: false } });
    expect(await priceForCheckout(testPlanId, 'MONTHLY')).toBeNull();
    const { access, plan } = await entitlementsFor(orgIds[0]);
    expect(access.state).toBe('active');
    expect(plan.id).toBe(testPlanId);
  });
});
