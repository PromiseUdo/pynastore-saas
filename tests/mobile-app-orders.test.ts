/*
 * A store's own app as an order (ROADMAP 16.2), against the real database.
 * Paystack and email are stubbed; the request, payment, staff steps,
 * renewals and lapsing run for real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions';
import { dropBilling, givePlan } from './helpers/plans';

const session = vi.hoisted(() => ({ userId: '' }));
vi.mock('@/lib/auth', () => ({ auth: async () => (session.userId ? { user: { id: session.userId } } : null) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: '', slug: '', logoUrl: null, status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', warehouseIds: [] as string[], role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: '',
}));
vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const mail = vi.hoisted(() => [] as { to: string | string[]; subject: string }[]);
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendPlatformNoticeEmail: async (p: { to: string | string[]; subject: string }) => {
    mail.push(p);
    return true;
  },
}));
vi.mock('@/lib/billing/paystack', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/paystack')>()),
  initializeTransaction: async (p: { reference: string }) => ({
    authorizationUrl: `https://checkout.paystack.test/${p.reference}`,
    accessCode: 'x',
    reference: p.reference,
  }),
}));

const merchant = await import('@/features/mobile-app/actions');
const staff = await import('@/features/platform/mobile-apps');
const { applySuccessfulCharge } = await import('@/lib/billing/apply-charge');
const { runMobileAppRenewals, renewalReminderDue } = await import('@/lib/mobile/renewals');
const { checkMobileAppRequest, proposedAppId, nextPaidThrough, canRenew } = await import('@/lib/mobile/orders');
const { mobileAppForUserAgent } = await import('@/lib/mobile/store-apps');

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const DAY = 24 * 60 * 60 * 1000;
const shop = { id: '', slug: `test-app-${suffix}` };
const trialShop = { id: '', slug: `test-app-trial-${suffix}` };
let staffId = '';
let ownerId = '';
const SETTING_KEYS = ['mobile_app_setup_fee', 'mobile_app_yearly_fee', 'mobile_app_grace_days'];
let savedSettings: { key: string; value: string }[] = [];

function as(org: { id: string; slug: string }, permissions = [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_EDIT, PERMISSIONS.BILLING_MANAGE]) {
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.userId = ownerId;
  ctx.membership.role.permissions = permissions;
}

const icon = (orgId: string) => ({
  url: `https://res.cloudinary.com/ci-cloud/image/upload/v1/mansaas/${orgId}/mobile-app/icon.png`,
  publicId: `mansaas/${orgId}/mobile-app/icon`,
  width: 1024,
  height: 1024,
});
const request = (orgId: string) => ({
  name: 'Test Shop',
  icon: icon(orgId),
  backgroundColor: '#4F46E5',
  shortDescription: 'Bags and shoes',
  wantsAndroid: true,
  wantsIos: true,
});

async function pay(kind: 'SETUP' | 'RENEWAL') {
  const payment = await prisma.mobileAppPayment.findFirstOrThrow({
    where: { mobileApp: { organizationId: shop.id }, kind, paidAt: null },
    include: { billingTransaction: true },
    orderBy: { createdAt: 'desc' },
  });
  const charge = {
    reference: payment.billingTransaction.reference,
    status: 'success',
    amount: Number(payment.amount) * 100,
    currency: 'NGN',
    customer: { customer_code: `CUS_${suffix}`, email: `app-owner-${suffix}@example.com` },
  };
  await applySuccessfulCharge(charge);
  await applySuccessfulCharge(charge); // the webhook after the callback: applied once
}

beforeAll(async () => {
  savedSettings = await prisma.platformSetting.findMany({ where: { key: { in: SETTING_KEYS } } });
  await prisma.platformSetting.deleteMany({ where: { key: { in: SETTING_KEYS } } });

  staffId = (await prisma.user.create({ data: { name: 'App Staff', email: `app-staff-${suffix}@example.com`, isPlatformStaff: true } })).id;
  ownerId = (await prisma.user.create({ data: { name: 'Owner', email: `app-owner-${suffix}@example.com` } })).id;
  for (const s of [shop, trialShop]) {
    const org = await prisma.organization.create({ data: { name: s === shop ? 'Test Shop' : 'Trial Shop', slug: s.slug } });
    s.id = org.id;
    const role = await prisma.role.create({ data: { organizationId: org.id, name: SYSTEM_ROLES.OWNER.name, isSystem: true } });
    await prisma.membership.create({ data: { userId: ownerId, organizationId: org.id, roleId: role.id, status: 'ACTIVE' } });
  }
  await givePlan(shop.id, 'pro');
  await prisma.subscription.create({
    data: { organizationId: trialShop.id, status: 'TRIALING', trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 10 * DAY) },
  });
});

afterAll(async () => {
  await prisma.platformSetting.deleteMany({ where: { key: { in: SETTING_KEYS } } });
  for (const row of savedSettings) await prisma.platformSetting.create({ data: row });
  for (const s of [shop, trialShop]) {
    await prisma.mobileApp.deleteMany({ where: { organizationId: s.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: s.id } });
    await prisma.membership.deleteMany({ where: { organizationId: s.id } });
    await prisma.role.deleteMany({ where: { organizationId: s.id } });
    await dropBilling(s.id);
    await prisma.organization.delete({ where: { id: s.id } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [staffId, ownerId] } } });
});

describe('the rules', () => {
  it('check what the merchant typed', () => {
    expect(checkMobileAppRequest(request('x'))).toEqual({});
    expect(
      Object.keys(
        checkMobileAppRequest({
          name: 'A name far longer than thirty characters',
          icon: { url: 'u', publicId: 'p', width: 512, height: 512 },
          backgroundColor: 'blue',
          shortDescription: 'x'.repeat(81),
          wantsAndroid: false,
          wantsIos: false,
        }),
      ).sort(),
    ).toEqual(['backgroundColor', 'icon', 'name', 'platforms', 'shortDescription']);
    expect(checkMobileAppRequest({ ...request('x'), icon: { url: 'u', publicId: 'p', width: 1400, height: 1024 } }).icon).toMatch(/square/);
  });

  it('suggest an app id from the handle', () => {
    expect(proposedAppId('pyna-code')).toBe('com.pynacode.shop');
    expect(proposedAppId('9lives')).toBe('com.s9lives.shop');
    expect(proposedAppId('pyna-code', 1)).toBe('com.pynacode2.shop');
  });

  it('add a year from the later of today and the paid date, and open renewal 60 days ahead', () => {
    const now = new Date('2026-10-04T00:00:00Z');
    expect(nextPaidThrough(null, now).toISOString().slice(0, 10)).toBe('2027-10-04');
    expect(nextPaidThrough(new Date('2026-12-01T00:00:00Z'), now).toISOString().slice(0, 10)).toBe('2027-12-01');
    expect(canRenew({ stage: 'LIVE', paidThrough: new Date(now.getTime() + 90 * DAY) }, now)).toBe(false);
    expect(canRenew({ stage: 'LIVE', paidThrough: new Date(now.getTime() + 30 * DAY) }, now)).toBe(true);
    expect(canRenew({ stage: 'REQUESTED', paidThrough: null }, now)).toBe(false);
  });

  it('remind 30, 7 and 1 day(s) before, once each', () => {
    const now = new Date('2026-10-04T12:00:00Z');
    const at = (days: number) => new Date(now.getTime() + days * DAY);
    expect(renewalReminderDue(at(45), now)).toBeNull();
    expect(renewalReminderDue(at(25), now)?.kind).toMatch(/^before_30:/);
    expect(renewalReminderDue(at(5), now)?.kind).toMatch(/^before_7:/);
    expect(renewalReminderDue(at(0.5), now)?.kind).toMatch(/^before_1:/);
    expect(renewalReminderDue(at(-1), now)).toBeNull();
  });
});

describe('ordering an app', () => {
  it('is not on sale until staff set a price', async () => {
    as(shop);
    expect(await merchant.payForMobileAppAction('SETUP')).toMatchObject({ success: false, error: expect.stringMatching(/on sale/) });
    session.userId = staffId;
    const current = await (await import('@/features/platform/billing-settings')).getConsoleBillingSettings();
    if (!current.success) throw new Error(current.error);
    const saved = await (await import('@/features/platform/billing-settings')).updateBillingSettings({
      ...current.data,
      mobileAppSetupFee: 150000,
      mobileAppYearlyFee: 60000,
      mobileAppGraceDays: 7,
    });
    expect(saved).toMatchObject({ success: true });
  });

  it('needs a paid plan to pay', async () => {
    as(trialShop);
    expect(await merchant.saveMobileAppRequestAction(request(trialShop.id))).toMatchObject({ success: true });
    expect(await merchant.payForMobileAppAction('SETUP')).toMatchObject({ success: false, error: expect.stringMatching(/paid plan/) });
  });

  it('refuses an icon that isn’t the store’s own upload', async () => {
    as(shop);
    const r = await merchant.saveMobileAppRequestAction({ ...request(shop.id), icon: icon(trialShop.id) });
    expect(r).toMatchObject({ success: false, fieldErrors: { icon: expect.any(String) } });
  });

  it('saves the request with a suggested app id, and needs settings.edit', async () => {
    as(shop, [PERMISSIONS.SETTINGS_VIEW]);
    expect(await merchant.saveMobileAppRequestAction(request(shop.id))).toMatchObject({ success: false });
    as(shop);
    expect(await merchant.saveMobileAppRequestAction(request(shop.id))).toMatchObject({ success: true });
    const app = await prisma.mobileApp.findUniqueOrThrow({ where: { organizationId: shop.id } });
    expect(app).toMatchObject({ stage: 'REQUESTED', appId: proposedAppId(shop.slug), backgroundColor: '#4f46e5', name: 'Test Shop' });
  });

  it('takes the setup fee, then waits for staff', async () => {
    as(shop, [PERMISSIONS.SETTINGS_VIEW]);
    expect(await merchant.payForMobileAppAction('SETUP')).toMatchObject({ success: false, error: expect.stringMatching(/permission/) });
    as(shop);
    const started = await merchant.payForMobileAppAction('SETUP');
    expect(started).toMatchObject({ success: true, data: { authorizationUrl: expect.stringContaining('paystack.test') } });

    mail.length = 0;
    process.env.PLATFORM_ADMIN_EMAIL ||= 'staff@example.com';
    await pay('SETUP');
    const app = await prisma.mobileApp.findUniqueOrThrow({ where: { organizationId: shop.id }, include: { payments: true } });
    expect(app.stage).toBe('PAID');
    expect(app.paidThrough!.getTime()).toBeGreaterThan(Date.now() + 364 * DAY);
    expect(app.payments.filter((p) => p.paidAt)).toHaveLength(1);
    expect(mail.filter((m) => m.subject.startsWith('New store app to build'))).toHaveLength(1);
    // The plan was not touched.
    expect(await prisma.subscription.findUniqueOrThrow({ where: { organizationId: shop.id } })).toMatchObject({ status: 'ACTIVE' });
  });

  it('can no longer be withdrawn or changed once building starts', async () => {
    as(shop);
    expect(await merchant.cancelMobileAppRequestAction()).toMatchObject({ success: false });
  });
});

describe('the staff side', () => {
  const appRow = () => prisma.mobileApp.findUniqueOrThrow({ where: { organizationId: shop.id } });

  it('is staff only', async () => {
    session.userId = ownerId;
    expect(await staff.listAppQueue({})).toMatchObject({ success: false, error: expect.stringMatching(/platform staff/) });
  });

  it('queues paid apps to build', async () => {
    session.userId = staffId;
    const queue = await staff.listAppQueue({ tab: 'TO_BUILD' });
    expect(queue.success && queue.data.rows.some((r) => r.appName === 'Test Shop')).toBe(true);
  });

  it('builds, delivers, and goes live with the merchant told at each turn', async () => {
    session.userId = staffId;
    const app = await appRow();
    expect(await staff.updateAppIdentity(app.id, { appId: `com.testapp${suffix}.shop`, name: 'Test Shop' })).toMatchObject({ success: true });
    expect(await staff.markAppBuilding(app.id)).toMatchObject({ success: true });
    expect(await staff.markAppBuilding(app.id)).toMatchObject({ success: false });

    as(shop);
    expect(await merchant.saveMobileAppRequestAction(request(shop.id))).toMatchObject({ success: false, error: expect.stringMatching(/being built/) });

    session.userId = staffId;
    mail.length = 0;
    expect(await staff.markAppDelivered(app.id, { versionName: '1.0.0', buildNumber: 1, downloadUrl: '', note: '' })).toMatchObject({
      success: false,
      error: expect.stringMatching(/Android files/),
    });
    expect(
      await staff.markAppDelivered(app.id, { versionName: '1.0.0', buildNumber: 1, downloadUrl: 'https://files.example/app', note: 'In TestFlight' }),
    ).toMatchObject({ success: true });
    expect(await appRow()).toMatchObject({ stage: 'DELIVERED', versionName: '1.0.0' });
    expect(mail.some((m) => m.subject.includes('ready to publish'))).toBe(true);

    // The id is permanent now.
    expect(await staff.updateAppIdentity(app.id, { appId: `com.other${suffix}.shop`, name: 'Test Shop' })).toMatchObject({ success: false });

    mail.length = 0;
    expect(await staff.recordAppListings(app.id, { appStoreId: '1234567890', onGooglePlay: true })).toMatchObject({ success: true });
    expect(await appRow()).toMatchObject({ stage: 'LIVE', appStoreId: '1234567890', onGooglePlay: true });
    expect(mail.some((m) => m.subject.includes('is live'))).toBe(true);
  });
});

describe('renewing', () => {
  it('reminds once, grants the grace days, then switches the app off', async () => {
    const app = await prisma.mobileApp.findUniqueOrThrow({ where: { organizationId: shop.id } });
    const now = new Date();
    await prisma.mobileApp.update({ where: { id: app.id }, data: { paidThrough: new Date(now.getTime() + 5 * DAY) } });

    mail.length = 0;
    expect(await runMobileAppRenewals({ now, only: [shop.id] })).toMatchObject({ reminders: 1 });
    expect(await runMobileAppRenewals({ now, only: [shop.id] })).toMatchObject({ reminders: 0 });
    expect(mail.filter((m) => m.subject.startsWith('Renew'))).toHaveLength(1);

    const ended = new Date(now.getTime() + 6 * DAY);
    expect(await runMobileAppRenewals({ now: ended, only: [shop.id] })).toMatchObject({ inGrace: 1 });
    const inGrace = await prisma.mobileApp.findUniqueOrThrow({ where: { id: app.id } });
    expect(inGrace.status).toBe('ACTIVE');
    expect(inGrace.graceEndsAt!.getTime()).toBe(ended.getTime() + 7 * DAY);

    expect(await runMobileAppRenewals({ now: new Date(ended.getTime() + 8 * DAY), only: [shop.id] })).toMatchObject({ lapsed: 1 });
    expect(await prisma.mobileApp.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: 'LAPSED' });
    await expect(mobileAppForUserAgent(`Mozilla/5.0 MansaasApp/${inGrace.appId}`)).resolves.toMatchObject({ mode: 'closed' });
  });

  it('switches it straight back on when the merchant renews', async () => {
    as(shop);
    expect(await merchant.payForMobileAppAction('RENEWAL')).toMatchObject({ success: true });
    await pay('RENEWAL');
    const app = await prisma.mobileApp.findUniqueOrThrow({ where: { organizationId: shop.id } });
    expect(app).toMatchObject({ status: 'ACTIVE', graceEndsAt: null, lapsedAt: null });
    expect(app.paidThrough!.getTime()).toBeGreaterThan(Date.now() + 364 * DAY);
    await expect(mobileAppForUserAgent(`Mozilla/5.0 MansaasApp/${app.appId}`)).resolves.toMatchObject({ mode: 'branded', lockedSlug: shop.slug });
  });

  it("lets the merchant turn the website's offer off", async () => {
    as(shop);
    expect(await merchant.setAppPromotionAction(false)).toMatchObject({ success: true });
    expect(await prisma.mobileApp.findUniqueOrThrow({ where: { organizationId: shop.id } })).toMatchObject({ promoteOnWebsite: false });
  });
});
