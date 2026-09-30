/*
 * Custom domains (ROADMAP 12.6) and the staff queue (11.5), against the real
 * database. DNS, Namecheap, Paystack and email are stubbed; routing, the
 * queue, the checklist and the lifecycle run for real.
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

const dns = vi.hoisted(() => ({ a: [] as string[], cname: [] as string[] }));
vi.mock('dns/promises', () => ({
  resolve4: async () => dns.a,
  resolveCname: async () => dns.cname,
}));

const mail = vi.hoisted(() => [] as { to: string | string[]; subject: string }[]);
const staffAlerts = vi.hoisted(() => [] as { domain: string }[]);
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendPlatformNoticeEmail: async (p: { to: string | string[]; subject: string }) => {
    mail.push(p);
    return true;
  },
  sendDomainOrderNotificationEmail: async (p: { domain: string }) => {
    staffAlerts.push(p);
  },
}));
vi.mock('@/lib/domains/namecheap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/domains/namecheap')>()),
  getTldPriceUsd: async (_tld: string, category: string) => (category === 'renew' ? 15 : 12),
  getAccountBalance: async () => ({ availableUsd: 5, accountUsd: 5, currency: 'USD', fetchedAt: new Date() }),
  searchDomain: async (d: string) => ({ domain: d, available: true, priceUsd: 12, renewUsd: 15 }),
  searchDomains: async (ds: string[]) => ds.map((d) => ({ domain: d, available: true, priceUsd: 12, renewUsd: 15 })),
}));
vi.mock('@/lib/billing/paystack', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/paystack')>()),
  initializeTransaction: async (p: { reference: string }) => ({ authorizationUrl: `https://checkout.paystack.test/${p.reference}`, accessCode: 'x', reference: p.reference }),
}));

const envWas = { cname: process.env.CUSTOM_DOMAIN_CNAME_TARGET, ip: process.env.CUSTOM_DOMAIN_APEX_IP };
process.env.CUSTOM_DOMAIN_CNAME_TARGET = 'cname.host.test';
process.env.CUSTOM_DOMAIN_APEX_IP = '203.0.113.7';

const domains = await import('@/features/domains/actions');
const staff = await import('@/features/platform/domains');
const { resolveTenant } = await import('@/lib/tenant/resolveTenant');
const { storefrontUrlFor } = await import('@/lib/domains/storefront-url');
const { forgetOrgStatus } = await import('@/lib/tenant/org-status');
const { applySuccessfulCharge } = await import('@/lib/billing/apply-charge');
const { runDomainLifecycle } = await import('@/lib/domains/lifecycle');

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const DAY = 24 * 60 * 60 * 1000;
const trialShop = { id: '', slug: `__test-dom-trial-${suffix}` };
const paidShop = { id: '', slug: `__test-dom-paid-${suffix}` };
const ownDomain = `own-${suffix}.com`;
const boughtDomain = `bought-${suffix}.com`;
let staffId = '';
let ownerId = '';

function as(org: { id: string; slug: string }, permissions = [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_EDIT, PERMISSIONS.BILLING_MANAGE]) {
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.userId = ownerId;
  ctx.membership.role.permissions = permissions;
}
const custom = (hostname: string) => resolveTenant({ hostname, siteType: 'unknown', subdomain: null, isCustomDomain: true });

beforeAll(async () => {
  staffId = (await prisma.user.create({ data: { name: 'Domain Staff', email: `dom-staff-${suffix}@example.com`, isPlatformStaff: true } })).id;
  ownerId = (await prisma.user.create({ data: { name: 'Owner', email: `dom-owner-${suffix}@example.com` } })).id;
  for (const shop of [trialShop, paidShop]) {
    const org = await prisma.organization.create({ data: { name: shop === trialShop ? 'Trial Shop' : 'Paid Shop', slug: shop.slug } });
    shop.id = org.id;
    const role = await prisma.role.create({ data: { organizationId: org.id, name: SYSTEM_ROLES.OWNER.name, isSystem: true } });
    await prisma.membership.create({ data: { userId: ownerId, organizationId: org.id, roleId: role.id, status: 'ACTIVE' } });
  }
  await prisma.subscription.create({
    data: { organizationId: trialShop.id, status: 'TRIALING', trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 10 * DAY) },
  });
  await givePlan(paidShop.id, 'pro');
});

afterAll(async () => {
  process.env.CUSTOM_DOMAIN_CNAME_TARGET = envWas.cname;
  process.env.CUSTOM_DOMAIN_APEX_IP = envWas.ip;
  for (const shop of [trialShop, paidShop]) {
    await prisma.domainOrder.deleteMany({ where: { organizationId: shop.id } });
    await prisma.shopDomain.deleteMany({ where: { organizationId: shop.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: shop.id } });
    await prisma.membership.deleteMany({ where: { organizationId: shop.id } });
    await prisma.role.deleteMany({ where: { organizationId: shop.id } });
    await dropBilling(shop.id);
    await prisma.organization.delete({ where: { id: shop.id } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [staffId, ownerId] } } });
});

describe('connecting a domain the merchant owns', () => {
  it('is allowed on the trial, while buying is not', async () => {
    as(trialShop);
    expect(await domains.buyDomain('trialbuy')).toMatchObject({ success: false, error: expect.stringMatching(/paid plan/) });
    expect(await domains.connectDomain(`https://www.${ownDomain.toUpperCase()}/`)).toEqual({ success: true, data: { domain: ownDomain } });
    expect(await prisma.shopDomain.findUnique({ where: { organizationId: trialShop.id } })).toMatchObject({
      hostname: ownDomain,
      canonicalHost: `www.${ownDomain}`,
      source: 'CONNECTED',
      status: 'PENDING',
    });

    as(paidShop);
    expect(await domains.connectDomain(ownDomain)).toMatchObject({ success: false, error: expect.stringMatching(/another shop/) });
  });

  it('joins the staff queue only once the records are right', async () => {
    as(trialShop);
    dns.a = ['198.51.100.1'];
    dns.cname = [];
    const wrong = await domains.checkMyDomain();
    expect(wrong).toMatchObject({ success: true, data: { ok: false, queued: false, apex: { ok: false, found: ['198.51.100.1'] } } });
    expect(await prisma.domainOrder.count({ where: { organizationId: trialShop.id } })).toBe(0);

    dns.a = ['203.0.113.7'];
    dns.cname = ['cname.host.test.'];
    staffAlerts.length = 0;
    expect(await domains.checkMyDomain()).toMatchObject({ success: true, data: { ok: true, queued: true } });
    const order = await prisma.domainOrder.findFirstOrThrow({ where: { organizationId: trialShop.id } });
    expect(order).toMatchObject({ type: 'EXISTING', status: 'PENDING_FULFILLMENT' });
    expect(order.readyAt).not.toBeNull();
    expect(staffAlerts).toEqual([expect.objectContaining({ domain: ownDomain })]);
  });

  it('is put live by staff once the checklist is done, and then routes — storefront only', async () => {
    session.userId = staffId;
    const queue = await staff.listDomainQueue({ tab: 'WAITING' });
    const row = queue.success ? queue.data.rows.find((r) => r.domain === ownDomain) : undefined;
    expect(row).toMatchObject({ type: 'EXISTING', stepsDone: 1, stepsTotal: 3 });

    expect(await staff.markDomainLive(row!.id)).toMatchObject({ success: false, error: expect.stringMatching(/every step/) });
    await staff.setDomainStep(row!.id, 'host', true);
    await staff.setDomainStep(row!.id, 'checked', true);
    mail.length = 0;
    expect(await staff.markDomainLive(row!.id)).toMatchObject({ success: true });
    expect(mail[0]).toMatchObject({ to: [`dom-owner-${suffix}@example.com`], subject: expect.stringMatching(/live at www\./) });

    expect(await custom(`www.${ownDomain}`)).toEqual({ orgSlug: trialShop.slug, siteType: 'storefront', status: 'ACTIVE' });
    expect(await custom(ownDomain)).toEqual({ orgSlug: trialShop.slug, siteType: 'storefront', status: 'ACTIVE', redirectHost: `www.${ownDomain}` });
    forgetOrgStatus(trialShop.slug);
    expect(await storefrontUrlFor(trialShop.slug, '/products')).toBe(`https://www.${ownDomain}/products`);

    // A dashboard never resolves on a merchant's domain, even one set on the old admin column.
    await prisma.organization.update({ where: { id: trialShop.id }, data: { customAdminDomain: `admin-${ownDomain}` } });
    expect(await custom(`admin-${ownDomain}`)).toBeNull();
  });

  it('stops routing when the merchant removes it', async () => {
    as(trialShop);
    expect(await domains.removeDomain()).toMatchObject({ success: true });
    expect(await custom(`www.${ownDomain}`)).toBeNull();
    forgetOrgStatus(trialShop.slug);
    expect(await storefrontUrlFor(trialShop.slug)).not.toContain(ownDomain);
    expect((await prisma.shopDomain.findUniqueOrThrow({ where: { organizationId: trialShop.id } })).status).toBe('DISCONNECTED');
  });
});

describe('buying a domain', () => {
  it('charges the quoted price, and joins the queue only once paid', async () => {
    as(paidShop);
    const started = await domains.buyDomain(boughtDomain.replace('.com', ''));
    expect(started).toMatchObject({ success: true, data: { authorizationUrl: expect.stringContaining('checkout.paystack.test') } });
    const order = await prisma.domainOrder.findFirstOrThrow({ where: { organizationId: paidShop.id, type: 'REGISTER' }, include: { billingTransaction: true } });
    expect(order.domain).toBe(boughtDomain);
    expect(Number(order.billingTransaction!.amount)).toBe(Number(order.ngnPrice));

    session.userId = staffId;
    const before = await staff.listDomainQueue({ tab: 'WAITING' });
    expect(before.success && before.data.rows.some((r) => r.id === order.id)).toBe(false);

    await applySuccessfulCharge({
      reference: order.billingTransaction!.reference,
      status: 'success',
      amount: Number(order.ngnPrice) * 100,
      currency: 'NGN',
      customer: { customer_code: `CUS_${suffix}`, email: `dom-owner-${suffix}@example.com` },
    });
    expect(await prisma.shopDomain.findUnique({ where: { organizationId: paidShop.id } })).toMatchObject({ hostname: boughtDomain, source: 'REGISTERED', status: 'PENDING' });
    const after = await staff.listDomainQueue({ tab: 'WAITING' });
    expect(after.success && after.data.rows.some((r) => r.id === order.id)).toBe(true);
    // The console weighs the live balance against what waiting work will spend.
    if (!after.success) throw new Error(after.error);
    expect(after.data.liveBalance).toMatchObject({ availableUsd: 5 });
    expect(after.data.waitingCost.usd).toBeGreaterThanOrEqual(12);
    expect(after.data.waitingCost.orders).toBeGreaterThanOrEqual(1);
  });

  it('needs the registrar expiry recorded, then goes live with it', async () => {
    session.userId = staffId;
    const order = await prisma.domainOrder.findFirstOrThrow({ where: { organizationId: paidShop.id, type: 'REGISTER' } });
    expect(await staff.setDomainStep(order.id, 'registered', true)).toMatchObject({ success: false, error: expect.stringMatching(/expiry date/) });
    const expiry = new Date(Date.now() + 365 * DAY).toISOString().slice(0, 10);
    expect(await staff.setDomainStep(order.id, 'registered', true, expiry)).toMatchObject({ success: true });
    for (const step of ['dns', 'host', 'checked'] as const) await staff.setDomainStep(order.id, step, true);
    expect(await staff.markDomainLive(order.id)).toMatchObject({ success: true });
    const domain = await prisma.shopDomain.findUniqueOrThrow({ where: { organizationId: paidShop.id } });
    expect(domain.status).toBe('LIVE');
    expect(domain.expiresAt?.toISOString().slice(0, 10)).toBe(expiry);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: paidShop.id } })).customStoreDomain).toBe(`www.${boughtDomain}`);
  });
});

describe('renewal and expiry', () => {
  it('reminds once, stops once renewal is paid, and takes an expired domain out of routing', async () => {
    await prisma.shopDomain.update({ where: { organizationId: paidShop.id }, data: { expiresAt: new Date(Date.now() + 20 * DAY) } });
    mail.length = 0;
    expect((await runDomainLifecycle({ only: [paidShop.id] })).reminders).toBe(1);
    expect(mail[0].subject).toMatch(/Renew bought-/);
    expect((await runDomainLifecycle({ only: [paidShop.id] })).reminders).toBe(0);

    as(paidShop);
    const renew = await domains.renewDomain();
    expect(renew).toMatchObject({ success: true });
    const renewal = await prisma.domainOrder.findFirstOrThrow({ where: { organizationId: paidShop.id, type: 'RENEW' }, include: { billingTransaction: true } });
    await applySuccessfulCharge({
      reference: renewal.billingTransaction!.reference,
      status: 'success',
      amount: Number(renewal.ngnPrice) * 100,
      currency: 'NGN',
      customer: { customer_code: `CUS_${suffix}`, email: `dom-owner-${suffix}@example.com` },
    });
    await prisma.shopDomain.update({ where: { organizationId: paidShop.id }, data: { expiresAt: new Date(Date.now() + 5 * DAY) } });
    expect((await runDomainLifecycle({ only: [paidShop.id] })).reminders).toBe(0);
    expect(await domains.renewDomain()).toMatchObject({ success: false, error: expect.stringMatching(/already renewed/) });

    await prisma.shopDomain.update({ where: { organizationId: paidShop.id }, data: { expiresAt: new Date(Date.now() - DAY) } });
    expect((await runDomainLifecycle({ only: [paidShop.id] })).expired).toBe(1);
    expect((await prisma.shopDomain.findUniqueOrThrow({ where: { organizationId: paidShop.id } })).status).toBe('EXPIRED');
    expect(await custom(`www.${boughtDomain}`)).toBeNull();
  });
});

describe('when it can’t be done', () => {
  it('records a reason the merchant sees, and a refund for a paid order', async () => {
    session.userId = staffId;
    const renewal = await prisma.domainOrder.findFirstOrThrow({ where: { organizationId: paidShop.id, type: 'RENEW' } });
    expect(await staff.markDomainFailed(renewal.id, 'short')).toMatchObject({ success: false });
    mail.length = 0;
    expect(await staff.markDomainFailed(renewal.id, 'The registry refused the renewal after the expiry date.')).toMatchObject({ success: true });
    expect(mail[0].subject).toMatch(/couldn’t set up/);
    expect(await staff.recordDomainRefund(renewal.id, { amount: 999_999_999, reference: 'RF1' })).toMatchObject({ success: false });
    expect(await staff.recordDomainRefund(renewal.id, { amount: Number(renewal.ngnPrice), reference: 'RF1' })).toMatchObject({ success: true });
    expect((await prisma.domainOrder.findUniqueOrThrow({ where: { id: renewal.id } })).refundReference).toBe('RF1');
    expect(await prisma.auditLog.count({ where: { organizationId: paidShop.id, action: 'platform.domain.refunded' } })).toBe(1);
  });

  it('is staff only', async () => {
    session.userId = ownerId;
    expect(await staff.listDomainQueue({})).toMatchObject({ success: false, error: expect.stringMatching(/platform staff/) });
  });
});
