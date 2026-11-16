/*
 * Trade buyers (ROADMAP 21.1), against the real database:
 *
 *   - Settings → Wholesale: who may change it, and that a trade buyer can
 *     always pay;
 *   - inviting a business: a new customer, or the existing one with that
 *     email; the set-up-your-sign-in email;
 *   - every change of standing, and the ones that aren't allowed;
 *   - another shop's customer is a miss, and the permission is checked;
 *   - checkout offers a trade buyer only what the merchant allows;
 *   - "Trade only" shows the catalogue to approved buyers and nobody else;
 *   - the buyer is told, by email in the shop's name;
 *   - the shopper's own data download includes it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { givePlan, dropBilling } from './helpers/plans';

const email = vi.hoisted(() => ({
  sendStorefrontNoticeEmail: vi.fn(async (_payload: { to: string[]; subject: string; button?: { url: string } }) => true),
}));
vi.mock('@/lib/email', async (original) => ({ ...(await original<typeof import('@/lib/email')>()), ...email }));

const session = vi.hoisted(() => ({ shopper: null as null | { id: string; organizationId: string } }));
vi.mock('@/lib/storefront/account/session', async (original) => ({
  ...(await original<typeof import('@/lib/storefront/account/session')>()),
  getShopperForStore: async () => session.shopper,
}));

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Trade Shop', slug: '', logoUrl: null, status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: '',
}));
vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';
import { pinDomains } from './helpers/storefront-requests';
import { discardAfterTasks, flushAfterTasks } from '@/lib/run-after';

const { saveWholesaleSettings } = await import('@/features/settings/wholesale');
const trade = await import('@/features/sales/trade');
const { requestTradeAccount, isTradeBuyer, tradeStanding } = await import('@/lib/trade/accounts');
const { registerShopper } = await import('@/lib/storefront/account/shopper');
const { getStoreCheckoutConfig } = await import('@/lib/storefront/checkout/store-config');
const { getTradeGate } = await import('@/lib/storefront/trade-gate');
const { listCustomerInsights } = await import('@/features/sales/customer-insights');
const { exportShopperData } = await import('@/lib/data-rights/shopper');

pinDomains();

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-trade-${suffix}` };
const other = { id: '', slug: `__test-trade-other-${suffix}` };
const ALL = Object.values(PERMISSIONS);
let shopperId = '';
let otherCustomerId = '';

const settingsOn = { mode: 'RETAIL_AND_TRADE' as const, requestsOpen: true, tradePayOnline: true, tradePayTransfer: true, tradePayOnDelivery: true, vatAdded: false, minOrderValue: null };
const details = { businessName: 'Ada Provisions', taxId: '12345678-0001', cacNumber: 'RC 1234567' };

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Trade Shop', slug: store.slug } })).id;
  other.id = (await prisma.organization.create({ data: { name: 'Other Shop', slug: other.slug } })).id;
  await givePlan(store.id); // Wholesale is a plan feature (22.1)
  ctx.organization.id = store.id;
  ctx.organization.slug = store.slug;
  ctx.userId = (await prisma.user.create({ data: { email: `trade-owner-${suffix}@example.com`, name: 'Owner' } })).id;
  ctx.membership.role.permissions = ALL;

  const shopper = await registerShopper({ organizationId: store.id, name: 'Ada Okoro', email: `ada-${suffix}@example.com`, password: 'a password here' });
  if (!shopper.ok) throw new Error('setup failed');
  shopperId = shopper.customer.id;
  otherCustomerId = (await prisma.customer.create({ data: { organizationId: other.id, name: 'Somebody Else' } })).id;
});

beforeEach(() => {
  discardAfterTasks();
  email.sendStorefrontNoticeEmail.mockClear();
  ctx.membership.role.permissions = ALL;
  session.shopper = null;
});

afterAll(async () => {
  for (const org of [store, other]) {
    await prisma.notificationEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.tradeAccount.deleteMany({ where: { organizationId: org.id } });
    await prisma.customerPasswordResetToken.deleteMany({ where: { customer: { organizationId: org.id } } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
    await dropBilling(org.id);
    await prisma.organization.delete({ where: { id: org.id } });
  }
  await prisma.user.deleteMany({ where: { id: ctx.userId } });
});

describe('Settings → Wholesale', () => {
  it('starts off, and saves the merchant’s choices', async () => {
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: store.id } })).wholesaleMode).toBe('OFF');
    expect(await saveWholesaleSettings(settingsOn)).toEqual({ success: true, data: undefined });
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: store.id } });
    expect(org.wholesaleMode).toBe('RETAIL_AND_TRADE');
    expect(org.wholesaleRequestsOpen).toBe(true);
  });

  it('keeps at least one way for a trade buyer to pay', async () => {
    const result = await saveWholesaleSettings({ ...settingsOn, tradePayOnline: false, tradePayTransfer: false, tradePayOnDelivery: false });
    expect(result).toEqual({ success: false, error: 'Leave at least one way for trade buyers to pay.' });
  });

  it('needs settings.edit', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW];
    const result = await saveWholesaleSettings(settingsOn);
    expect(result.success).toBe(false);
  });
});

describe('a shopper asks', () => {
  it('is refused while the shop takes no requests', async () => {
    await saveWholesaleSettings({ ...settingsOn, requestsOpen: false });
    const result = await requestTradeAccount({ organizationId: store.id, customerId: shopperId, details, note: null });
    expect(result).toEqual({ ok: false, reason: 'requests-closed' });
    await saveWholesaleSettings(settingsOn);
  });

  it('waits for the merchant, and can’t ask twice', async () => {
    const asked = await requestTradeAccount({ organizationId: store.id, customerId: shopperId, details, note: 'Two shops in Aba' });
    expect(asked).toMatchObject({ ok: true, status: 'REQUESTED' });
    expect(await requestTradeAccount({ organizationId: store.id, customerId: shopperId, details, note: null })).toEqual({ ok: false, reason: 'waiting' });
    // The tax ID lives on the customer, where invoices read it.
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: shopperId } })).taxId).toBe(details.taxId);
    expect(await isTradeBuyer(store.id, shopperId)).toBe(false);
  });

  it('shows in Customers under Trade requests, with its badge', async () => {
    const list = await listCustomerInsights({ segment: 'trade-requests' });
    expect(list.success && list.data.rows.map((r) => [r.id, r.tradeStatus])).toEqual([[shopperId, 'REQUESTED']]);
  });

  it('can be declined with a note they’re emailed, and asked again', async () => {
    expect(await trade.declineTradeRequest(shopperId, { reason: 'We only supply shops in Lagos' })).toEqual({ success: true, data: undefined });
    expect((await tradeStanding(store.id, shopperId))?.status).toBe('DECLINED');
    await flushAfterTasks();
    const sent = email.sendStorefrontNoticeEmail.mock.calls.at(-1)?.[0];
    expect(sent?.to).toEqual([`ada-${suffix}@example.com`]);
    expect(sent?.subject).toContain('trade account');
    // Their note travels with it.
    expect(JSON.stringify(sent)).toContain('We only supply shops in Lagos');

    const again = await requestTradeAccount({ organizationId: store.id, customerId: shopperId, details, note: null });
    expect(again).toMatchObject({ ok: true, status: 'REQUESTED' });
  });

  it('becomes a trade buyer when approved, and is told', async () => {
    const result = await trade.approveTradeBuyer(shopperId);
    expect(result).toEqual({ success: true, data: { invite: null } });
    expect(await isTradeBuyer(store.id, shopperId)).toBe(true);
    await flushAfterTasks();
    expect(email.sendStorefrontNoticeEmail.mock.calls.at(-1)?.[0].subject).toBe('Your trade account with Trade Shop is ready');
    expect(await trade.approveTradeBuyer(shopperId)).toEqual({ success: false, error: 'They’re already a trade buyer.' });
  });

  it('can be paused and reinstated, but not approved while paused', async () => {
    expect((await trade.suspendTradeBuyer(shopperId, {})).success).toBe(true);
    expect(await isTradeBuyer(store.id, shopperId)).toBe(false);
    expect(await trade.approveTradeBuyer(shopperId)).toEqual({ success: false, error: 'Their trade account is paused. Reinstate it instead.' });
    expect((await trade.reinstateTradeBuyer(shopperId)).success).toBe(true);
    expect(await isTradeBuyer(store.id, shopperId)).toBe(true);
  });

  it('can’t decline what isn’t a request', async () => {
    const result = await trade.declineTradeRequest(shopperId, {});
    expect(result.success).toBe(false);
  });
});

describe('inviting a business', () => {
  it('creates the customer, makes them a trade buyer, and emails a sign-in link', async () => {
    const result = await trade.inviteTradeBuyer({ name: 'Bola Ade', email: ` Bola-${suffix}@Example.com `, phone: '0803 123 4567', ...details, businessName: 'Bola Stores' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({ existing: false, invite: 'sent' });

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: result.data.customerId }, include: { tradeAccount: true } });
    expect(customer.email).toBe(`bola-${suffix}@example.com`);
    expect(customer.phone).toBe('+2348031234567');
    expect(customer.tradeAccount?.status).toBe('APPROVED');
    const link = email.sendStorefrontNoticeEmail.mock.calls.at(-1)?.[0].button?.url ?? '';
    expect(link).toMatch(/\/account\/reset-password\?token=[\w-]+&invite=1$/);
    // A week to use it, not the half hour a reset gets.
    const token = await prisma.customerPasswordResetToken.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(token.expiresAt.getTime() - Date.now()).toBeGreaterThan(6 * 24 * 3_600_000);
  });

  it('uses the customer who already has that email, whatever its capitals', async () => {
    const result = await trade.inviteTradeBuyer({ name: 'Bola', email: `BOLA-${suffix}@example.com`, ...details, businessName: 'Bola Stores' });
    expect(result.success && result.data.existing).toBe(true);
    expect(await prisma.customer.count({ where: { organizationId: store.id, email: `bola-${suffix}@example.com` } })).toBe(1);
  });

  it('is refused while wholesale is off', async () => {
    await saveWholesaleSettings({ ...settingsOn, mode: 'OFF' });
    const result = await trade.inviteTradeBuyer({ name: 'Chi', email: `chi-${suffix}@example.com`, ...details });
    expect(result).toEqual({ success: false, error: 'Turn on wholesale first, in Settings → Wholesale.' });
    // An approved buyer gets nothing while it's off.
    expect(await isTradeBuyer(store.id, shopperId)).toBe(false);
    await saveWholesaleSettings(settingsOn);
  });
});

describe('who may do what', () => {
  it('needs customer.trade.manage', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.CUSTOMER_VIEW, PERMISSIONS.CUSTOMER_EDIT];
    const result = await trade.suspendTradeBuyer(shopperId, {});
    expect(result.success).toBe(false);
    expect(await isTradeBuyer(store.id, shopperId)).toBe(true);
  });

  it('can’t reach another shop’s customer', async () => {
    const result = await trade.approveTradeBuyer(otherCustomerId, { details });
    expect(result).toEqual({ success: false, error: 'We couldn’t find that customer.' });
    expect(await prisma.tradeAccount.count({ where: { customerId: otherCustomerId } })).toBe(0);
  });
});

describe('checkout for a trade buyer', () => {
  it('offers only the ways the merchant allows for trade, and everyone else is unchanged', async () => {
    await saveWholesaleSettings({ ...settingsOn, tradePayOnDelivery: false });
    const retail = await getStoreCheckoutConfig({ organizationSlug: store.slug });
    const forTrade = await getStoreCheckoutConfig({ organizationSlug: store.slug }, { tradeBuyer: true });
    expect(retail.paymentMethods.map((m) => m.id)).toContain('pod');
    expect(forTrade.paymentMethods.map((m) => m.id)).not.toContain('pod');
    await saveWholesaleSettings(settingsOn);
  });
});

describe('Trade only', () => {
  it('shows the catalogue to approved trade buyers and nobody else', async () => {
    expect(await getTradeGate(store.slug)).toEqual({ tradeOnly: false, allowed: true });
    await saveWholesaleSettings({ ...settingsOn, mode: 'TRADE_ONLY' });

    session.shopper = null;
    expect(await getTradeGate(store.slug)).toEqual({ tradeOnly: true, allowed: false });

    session.shopper = { id: shopperId, organizationId: store.id };
    expect(await getTradeGate(store.slug)).toEqual({ tradeOnly: true, allowed: true });

    // A session from another shop is nobody here.
    session.shopper = { id: otherCustomerId, organizationId: other.id };
    expect(await getTradeGate(store.slug)).toEqual({ tradeOnly: true, allowed: false });

    await saveWholesaleSettings(settingsOn);
  });
});

describe('the shopper’s own data', () => {
  it('includes their trade account', async () => {
    const data = await exportShopperData(store.id, shopperId);
    expect(data?.tradeAccount).toMatchObject({ status: 'APPROVED', businessName: 'Ada Provisions', taxId: details.taxId });
  });
});
