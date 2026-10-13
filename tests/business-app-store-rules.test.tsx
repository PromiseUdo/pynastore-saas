/*
 * What the app stores require of the business app (ROADMAP 19.3):
 *   - no buying inside it, and nothing pointing to where to buy
 *     (App Review 3.1.3(f)) — while a browser, the business host included,
 *     keeps every price and button;
 *   - a staff member can delete their own account (5.1.1(v)), with the
 *     shop's records kept and nobody's shop left without an Owner.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hash } from 'bcryptjs';
import { prisma } from '@/lib/prisma';

const APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 MansaasApp/com.mansaas.business';
const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';

const state = vi.hoisted(() => ({
  ua: '',
  session: null as null | { user: { id: string } },
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'user-agent': state.ua, host: 'b.app.localhost:3000' }),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));
vi.mock('@/lib/auth', () => ({ auth: async () => state.session }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));
const ctx = vi.hoisted(() => ({
  organization: { id: 'org-x', name: 'Shop', slug: 'shop', logoUrl: null, status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', warehouseIds: [] as string[], role: { id: 'r', name: 'Owner', isSystem: true, permissions: ['billing.manage', 'settings.view', 'settings.edit'] } },
  userId: 'u-x',
}));
vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));
const entitlements = vi.hoisted(() => ({
  value: {
    plan: { id: 'plan-pro', name: 'Pro', features: [], limits: {} },
    access: { state: 'active', trialEndsAt: null, graceEndsAt: null },
    subscription: { planId: 'plan-pro', status: 'ACTIVE', billingCycle: 'MONTHLY', cancelAtPeriodEnd: false, currentPeriodEnd: new Date('2027-05-14T12:00:00Z'), amount: 25000 },
  } as Record<string, unknown>,
}));
vi.mock('@/lib/billing/entitlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/entitlements')>()),
  getOrganizationEntitlements: async () => entitlements.value,
}));
vi.mock('@/lib/billing/catalogue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/catalogue')>()),
  listPlansForSale: async () => [],
}));

const { isBusinessAppRequest, NOT_IN_THE_APP } = await import('@/lib/business-app/request');
const { NoBuyingProvider, UpgradeLink } = await import('@/components/business-app/no-buying');
const { PlanNotice, PlanEndedPage } = await import('@/components/layout/plan-notice');
const { planStatusLine } = await import('@/lib/billing/status-line');
const { createCheckoutSession } = await import('@/features/billing/actions');
const { searchComDomain, buyDomain, renewDomain } = await import('@/features/domains/actions');
const { saveMobileAppRequestAction, payForMobileAppAction } = await import('@/features/mobile-app/actions');
const UpgradePage = (await import('@/app/(dashboard)/[organizationSlug]/upgrade/page')).default;
const BillingPage = (await import('@/app/(dashboard)/[organizationSlug]/settings/billing/page')).default;
const { DomainClient } = await import('@/app/(dashboard)/[organizationSlug]/settings/domain/DomainClient');
const { MobileAppClient } = await import('@/app/(dashboard)/[organizationSlug]/settings/mobile-app/MobileAppClient');
const { deleteStaffAccount, staffDeletionBlockers, deletedEmailFor, FORMER_MEMBER } = await import('@/lib/data-rights/staff');
const { deleteMyAccount } = await import('@/features/account/actions');
const { isOpenWhileLapsed } = await import('@/lib/billing/access');

const html = (node: React.ReactNode, noBuying: boolean) => renderToStaticMarkup(<NoBuyingProvider value={noBuying}>{node}</NoBuyingProvider>);

beforeEach(() => {
  state.ua = APP_UA;
  state.session = null;
});

describe('telling the app from a browser', () => {
  it('by the business app’s marker only', async () => {
    expect(await isBusinessAppRequest()).toBe(true);
    state.ua = BROWSER_UA;
    expect(await isBusinessAppRequest()).toBe(false);
    // A store's own app (Phase 16) isn't the business app.
    state.ua = `${BROWSER_UA} MansaasApp/com.pynacode.shop`;
    expect(await isBusinessAppRequest()).toBe(false);
  });
});

describe('no buying in the app', () => {
  it('upgrade links vanish in the app, and stay in a browser', () => {
    const link = <UpgradeLink className="x">See plans</UpgradeLink>;
    expect(html(link, true)).toBe('');
    expect(html(link, false)).toContain('href="/upgrade"');
  });

  it('plan notices state the facts, with no call to choose a plan', () => {
    const trial = { state: 'trial' as const, planName: 'Pro', trialEndsAt: new Date('2026-11-01T12:00:00Z'), graceEndsAt: null, canManageBilling: true, now: new Date('2026-10-20T12:00:00Z') };
    const inApp = renderToStaticMarkup(<PlanNotice {...trial} noBuying />);
    expect(inApp).toContain('ends in 12 days');
    expect(inApp).not.toMatch(/Choose a plan|\/upgrade|Ask the owner/);
    expect(renderToStaticMarkup(<PlanNotice {...trial} />)).toContain('Choose a plan');

    for (const state of ['grace', 'lapsed'] as const) {
      const notice = renderToStaticMarkup(
        <PlanNotice state={state} planName="Pro" trialEndsAt={null} graceEndsAt={new Date('2026-11-01T12:00:00Z')} canManageBilling noBuying />,
      );
      expect(notice, state).not.toMatch(/choose a plan|\/upgrade/i);
    }
    const ended = renderToStaticMarkup(<PlanEndedPage canManageBilling noBuying />);
    expect(ended).not.toMatch(/choose a plan|\/upgrade/i);
    expect(ended).toContain('/sales/orders');
  });

  it('the plan line has no price in the app', () => {
    const input = {
      access: { state: 'active' as const, trialEndsAt: null, graceEndsAt: null },
      subscription: { currentPeriodEnd: new Date('2027-05-14T12:00:00Z'), cancelAtPeriodEnd: false, amount: 25000, billingCycle: 'MONTHLY' },
    };
    expect(planStatusLine({ ...input, noBuying: true })).toBe('Renews on 14 May 2027');
    expect(planStatusLine(input)).toMatch(/₦25,000/);
    expect(planStatusLine({ access: { state: 'lapsed', trialEndsAt: null, graceEndsAt: null }, subscription: null, noBuying: true })).not.toMatch(/choos/i);
    expect(planStatusLine({ access: { state: 'none', trialEndsAt: null, graceEndsAt: null }, subscription: null, noBuying: true })).not.toMatch(/choos/i);
  });

  it('every purchase action refuses in the app', async () => {
    const results = await Promise.all([
      createCheckoutSession({ planId: 'p', billingCycle: 'MONTHLY' } as never),
      searchComDomain('myshop'),
      buyDomain('myshop.com'),
      renewDomain(),
      saveMobileAppRequestAction({} as never),
      payForMobileAppAction('SETUP'),
    ]);
    for (const result of results) expect(result).toEqual({ success: false, error: NOT_IN_THE_APP });
  });

  it('/upgrade in the app is "Your plan": what it has, what is locked, no prices or buttons', async () => {
    const page = renderToStaticMarkup(await UpgradePage({ searchParams: Promise.resolve({ feature: 'inventory.multi_warehouse' }) }));
    expect(page).toContain('Your plan');
    expect(page).toContain('Pro plan');
    expect(page).toContain('More than one store');
    expect(page).toContain('Renews on 14 May 2027');
    expect(page).not.toMatch(/₦|<button|checkout/i);
  });

  it('Settings → Billing in the app: the plan and dates, no prices, no payment history, no plan button', async () => {
    const org = await prisma.organization.create({ data: { name: 'Billing App Test', slug: `__test-bizbill-${Date.now().toString(36)}` } });
    ctx.organization.id = org.id;
    try {
      await prisma.billingTransaction.create({
        data: { organizationId: org.id, reference: `ref-${org.id}`, amount: 25000, status: 'SUCCESS', type: 'CHECKOUT', billingCycle: 'MONTHLY', planName: 'Pro' },
      });
      const inApp = renderToStaticMarkup(html(await BillingPage({ searchParams: Promise.resolve({}) }), true));
      expect(inApp).toContain('Pro plan');
      expect(inApp).toContain('Renews on 14 May 2027');
      expect(inApp).not.toMatch(/₦|Payment history|Change plan|\/upgrade/);

      state.ua = BROWSER_UA;
      const inBrowser = renderToStaticMarkup(html(await BillingPage({ searchParams: Promise.resolve({}) }), false));
      expect(inBrowser).toMatch(/₦25,000/);
      expect(inBrowser).toContain('Payment history');
    } finally {
      await prisma.billingTransaction.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it('Settings → Domain in the app: connect one you own, never buy one', () => {
    const data = {
      platformUrl: 'https://shop-x.getnotely.io',
      domain: null,
      order: null,
      renewalPaid: false,
      renewNgn: null,
      records: [],
      paidPlan: true,
      canBuy: true,
      canConnect: true,
    };
    const inApp = html(<DomainClient data={data} />, true);
    expect(inApp).not.toContain('Get a new domain');
    expect(inApp).toMatch(/already own|connect/i);
    expect(html(<DomainClient data={data} />, false)).toContain('Get a new domain');
  });

  it('Settings → Mobile app in the app: nothing to order', () => {
    const data = { pricing: { setupFee: 150000, yearlyFee: 50000, graceDays: 14 }, paidPlan: true, canEdit: true, canPay: true, app: null };
    const inApp = html(<MobileAppClient data={data as never} />, true);
    expect(inApp).toContain('doesn’t have an Android or iPhone app');
    expect(inApp).not.toMatch(/₦|<button/);
    expect(html(<MobileAppClient data={data as never} />, false)).toMatch(/₦/);
  });
});

describe('deleting your own account', () => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const orgIds: string[] = [];
  const userIds: string[] = [];

  async function person(email: string, password: string | null) {
    const user = await prisma.user.create({ data: { email, name: 'Ada Staff', password: password ? await hash(password, 4) : null } });
    userIds.push(user.id);
    return user;
  }
  async function shop(name: string, status: 'ACTIVE' | 'DELETED' = 'ACTIVE') {
    const org = await prisma.organization.create({ data: { name, slug: `__test-bizdel-${orgIds.length}-${stamp}`, status } });
    orgIds.push(org.id);
    const owner = await prisma.role.create({ data: { organizationId: org.id, name: 'Owner', isSystem: true } });
    const staff = await prisma.role.create({ data: { organizationId: org.id, name: 'Staff', isSystem: false } });
    return { org, owner, staff };
  }

  afterAll(async () => {
    // The shop's records still point at the deleted person — which is why their row is kept.
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notificationEvent.deleteMany({ where: { key: `ev-${stamp}` } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  let ada: { id: string };
  let other: { id: string };
  let main: Awaited<ReturnType<typeof shop>>;

  beforeAll(async () => {
    ada = await person(`ada-${stamp}@example.test`, 'correct horse');
    other = await person(`other-${stamp}@example.test`, 'pw');
    main = await shop('Ada’s shop');
    await prisma.membership.create({ data: { userId: ada.id, organizationId: main.org.id, roleId: main.owner.id } });
    await prisma.membership.create({ data: { userId: other.id, organizationId: main.org.id, roleId: main.staff.id } });
    // A closed shop where Ada was the only Owner doesn't hold her back.
    const closed = await shop('Old shop', 'DELETED');
    await prisma.membership.create({ data: { userId: ada.id, organizationId: closed.org.id, roleId: closed.owner.id } });
  });

  it('waits while she is the only Owner of an open shop', async () => {
    expect(await staffDeletionBlockers(ada.id)).toEqual([{ name: 'Ada’s shop', slug: main.org.slug }]);
    expect(await deleteStaffAccount(ada.id, 'correct horse')).toEqual({
      ok: false,
      reason: 'sole-owner',
      shops: [{ name: 'Ada’s shop', slug: main.org.slug }],
    });
  });

  it('a wrong password deletes nothing', async () => {
    expect(await deleteStaffAccount(ada.id, 'wrong')).toEqual({ ok: false, reason: 'wrong-confirmation' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ada.id } })).deletedAt).toBeNull();
  });

  it('once someone else is an Owner: everything that reaches her goes, the shop’s records stay', async () => {
    await prisma.membership.updateMany({ where: { userId: other.id, organizationId: main.org.id }, data: { roleId: main.owner.id } });
    expect(await staffDeletionBlockers(ada.id)).toEqual([]);

    // What she has: a record in the shop, a sign-in link, a session, a phone, a notification.
    const record = await prisma.auditLog.create({ data: { organizationId: main.org.id, userId: ada.id, action: 'inventory.item.created', entityType: 'InventoryItem', entityId: 'i1' } });
    await prisma.account.create({ data: { userId: ada.id, type: 'oauth', provider: 'google', providerAccountId: `g-${stamp}` } });
    await prisma.session.create({ data: { userId: ada.id, sessionToken: `s-${stamp}`, expires: new Date(Date.now() + 86_400_000) } });
    await prisma.pushDevice.create({ data: { organizationId: main.org.id, appId: 'com.mansaas.business', platform: 'ANDROID', token: `t-${stamp}`, userId: ada.id } });
    const event = await prisma.notificationEvent.create({ data: { key: `ev-${stamp}`, kind: 'order.new', organizationId: main.org.id } });
    await prisma.notification.create({ data: { eventId: event.id, userId: ada.id, organizationId: main.org.id, kind: 'order.new', title: 'New order', body: 'R-1', target: {} } });

    state.session = { user: { id: ada.id } };
    expect(await deleteMyAccount('correct horse')).toEqual({ success: true });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: ada.id } });
    expect(after).toMatchObject({ name: FORMER_MEMBER, email: deletedEmailFor(ada.id), password: null, image: null, emailVerified: null, isPlatformStaff: false, sessionVersion: 1 });
    expect(after.deletedAt).not.toBeNull();
    expect(await prisma.membership.count({ where: { userId: ada.id } })).toBe(0);
    expect(await prisma.account.count({ where: { userId: ada.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: ada.id } })).toBe(0);
    expect(await prisma.pushDevice.count({ where: { userId: ada.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: ada.id } })).toBe(0);

    // The shop's record still points at her row, which now reads "Former member".
    const kept = await prisma.auditLog.findUniqueOrThrow({ where: { id: record.id }, include: { user: { select: { name: true, email: true } } } });
    expect(kept.user?.name).toBe(FORMER_MEMBER);
    // …and the shop is told she left.
    expect(await prisma.auditLog.count({ where: { organizationId: main.org.id, action: 'staff.account.deleted', userId: ada.id } })).toBe(1);

    // Her address is free to sign up with again; the old account can't be deleted twice.
    const again = await person(`ada-${stamp}@example.test`, null);
    expect(again.id).not.toBe(ada.id);
    expect(await deleteStaffAccount(ada.id, 'correct horse')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('a Google or Apple account confirms by typing its email', async () => {
    const google = await person(`Google.${stamp}@Example.test`, null);
    expect(await deleteStaffAccount(google.id, 'someone@else.test')).toEqual({ ok: false, reason: 'wrong-confirmation' });
    expect(await deleteStaffAccount(google.id, `  google.${stamp}@example.TEST `)).toEqual({ ok: true });
  });

  it('the action says what to do when she can’t yet', async () => {
    const solo = await person(`solo-${stamp}@example.test`, 'pw');
    const own = await shop('Solo shop');
    await prisma.membership.create({ data: { userId: solo.id, organizationId: own.org.id, roleId: own.owner.id } });
    state.session = { user: { id: solo.id } };
    const result = await deleteMyAccount('pw');
    expect(result).toMatchObject({ success: false, shops: [{ name: 'Solo shop' }] });
    expect(await deleteMyAccount('nope')).toEqual({ success: false, error: 'That doesn’t match. Nothing was deleted.' });
    state.session = null;
    expect(await deleteMyAccount('pw')).toEqual({ success: false, error: 'Sign in again to continue.' });
  });

  it('Settings → Your account stays open while the plan has lapsed', () => {
    expect(isOpenWhileLapsed('/settings/account')).toBe(true);
  });
});
