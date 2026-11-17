/*
 * The free .com.ng (ROADMAP 22.3) and buying a .com.ng, against the real
 * database. The .ng registry (RDAP), Paystack and email are stubbed; the
 * eligibility rules, the one-per-shop claim, the staff queue and the
 * catalogue run for real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions';
import { FEATURES } from '@/lib/billing/plans';
import { dropBilling, dropTestPlan, givePlan, givePlanWith } from './helpers/plans';

const session = vi.hoisted(() => ({ userId: '' }));
vi.mock('@/lib/auth', () => ({ auth: async () => (session.userId ? { user: { id: session.userId } } : null) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: '', slug: '', logoUrl: null, status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', warehouseIds: [] as string[], role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: '',
}));
vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

/** The .ng registry: names in `taken` are held; `down` makes it unreachable. */
const registry = vi.hoisted(() => ({ taken: new Set<string>(), down: false, asked: [] as string[] }));
vi.mock('@/lib/domains/comng', () => {
  const check = async (domain: string) => {
    registry.asked.push(domain);
    if (registry.down) return { domain, error: 'down' };
    return { domain, available: !registry.taken.has(domain) };
  };
  return { checkComNg: check, checkComNgMany: (ds: string[]) => Promise.all(ds.map(check)) };
});
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendPlatformNoticeEmail: async () => true,
}));
vi.mock('@/lib/billing/paystack', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/paystack')>()),
  initializeTransaction: async (p: { reference: string }) => ({ authorizationUrl: `https://checkout.paystack.test/${p.reference}`, accessCode: 'x', reference: p.reference }),
}));

const domains = await import('@/features/domains/actions');
const staff = await import('@/features/platform/domains');
const { freeDomainStatus } = await import('@/lib/domains/free-domain');
const { listPlansForSale } = await import('@/lib/billing/catalogue');

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const yearly = { id: '', slug: `__test-free-y-${suffix}` };
const monthly = { id: '', slug: `__test-free-m-${suffix}` };
const trial = { id: '', slug: `__test-free-t-${suffix}` };
const noFeature = { id: '', slug: `__test-free-n-${suffix}` };
const shops = [yearly, monthly, trial, noFeature];
const PRICE_KEYS = ['comng_register_price', 'comng_renew_price'];
let savedPrices: { key: string; value: string }[] = [];
let ownerId = '';
let staffId = '';

function as(org: { id: string; slug: string }) {
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.userId = ownerId;
  ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_EDIT, PERMISSIONS.BILLING_MANAGE];
}

async function setPrices(register: number | null, renew: number | null) {
  await prisma.platformSetting.deleteMany({ where: { key: { in: PRICE_KEYS } } });
  if (register !== null) await prisma.platformSetting.create({ data: { key: 'comng_register_price', value: String(register) } });
  if (renew !== null) await prisma.platformSetting.create({ data: { key: 'comng_renew_price', value: String(renew) } });
}

async function reset(org: { id: string }) {
  await prisma.domainOrder.deleteMany({ where: { organizationId: org.id } });
  await prisma.shopDomain.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.update({ where: { id: org.id }, data: { freeDomainClaimedAt: null } });
}

beforeAll(async () => {
  savedPrices = (await prisma.platformSetting.findMany({ where: { key: { in: PRICE_KEYS } } })).map((r) => ({ key: r.key, value: r.value }));
  ownerId = (await prisma.user.create({ data: { name: 'Owner', email: `free-owner-${suffix}@example.com` } })).id;
  staffId = (await prisma.user.create({ data: { name: 'Staff', email: `free-staff-${suffix}@example.com`, isPlatformStaff: true } })).id;
  for (const shop of shops) {
    const org = await prisma.organization.create({ data: { name: `Free ${shop.slug}`, slug: shop.slug } });
    shop.id = org.id;
    const role = await prisma.role.create({ data: { organizationId: org.id, name: SYSTEM_ROLES.OWNER.name, isSystem: true } });
    await prisma.membership.create({ data: { userId: ownerId, organizationId: org.id, roleId: role.id, status: 'ACTIVE' } });
  }
  // Growth ('pro') includes the free .com.ng (migration 20261117090000).
  await givePlan(yearly.id, 'pro');
  await prisma.subscription.update({ where: { organizationId: yearly.id }, data: { billingCycle: 'YEARLY' } });
  await givePlan(monthly.id, 'pro');
  await prisma.subscription.create({
    data: { organizationId: trial.id, planId: (await prisma.billingPlan.findUniqueOrThrow({ where: { key: 'pro' } })).id, status: 'TRIALING', trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 86400_000) },
  });
  await givePlanWith(noFeature.id, [FEATURES.INVENTORY_MODULE]);
  await prisma.subscription.update({ where: { organizationId: noFeature.id }, data: { billingCycle: 'YEARLY' } });
});

beforeEach(async () => {
  await setPrices(15000, 18000);
  registry.taken.clear();
  registry.down = false;
  registry.asked = [];
  session.userId = '';
});

afterAll(async () => {
  await prisma.platformSetting.deleteMany({ where: { key: { in: PRICE_KEYS } } });
  for (const row of savedPrices) await prisma.platformSetting.create({ data: row });
  for (const shop of shops) {
    await reset(shop);
    await prisma.auditLog.deleteMany({ where: { organizationId: shop.id } });
    await prisma.membership.deleteMany({ where: { organizationId: shop.id } });
    await prisma.role.deleteMany({ where: { organizationId: shop.id } });
    await dropBilling(shop.id);
    await prisma.organization.delete({ where: { id: shop.id } });
  }
  await dropTestPlan(noFeature.id);
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
});

describe('who gets a free .com.ng', () => {
  it('a paid yearly plan that includes it — not monthly, not a trial, not a plan without it', async () => {
    expect(await freeDomainStatus(yearly.id)).toEqual({ kind: 'available' });
    expect(await freeDomainStatus(monthly.id)).toEqual({ kind: 'not_yearly' });
    expect(await freeDomainStatus(trial.id)).toEqual({ kind: 'none' });
    expect(await freeDomainStatus(noFeature.id)).toEqual({ kind: 'none' });
  });

  it('nobody, while .com.ng isn’t on sale — and the plans stop advertising it', async () => {
    await setPrices(15000, null);
    expect(await freeDomainStatus(yearly.id)).toEqual({ kind: 'none' });
    const growth = (await listPlansForSale()).find((p) => p.key === 'pro');
    expect(growth?.features).not.toContain(FEATURES.FREE_DOMAIN);
    await setPrices(15000, 18000);
    expect((await listPlansForSale()).find((p) => p.key === 'pro')?.features).toContain(FEATURES.FREE_DOMAIN);
  });
});

describe('searching a .com.ng', () => {
  it('asks the .ng registry, and offers it free when the plan covers it', async () => {
    as(yearly);
    const r = await domains.searchDomain(`ada${suffix}`, 'com.ng');
    expect(r).toMatchObject({ success: true, data: { available: true, offer: { domain: `ada${suffix}.com.ng`, free: true, priceNgn: 15000, renewNgn: 18000 } } });
    expect(registry.asked).toEqual([`ada${suffix}.com.ng`]);

    as(monthly);
    expect(await domains.searchDomain(`ada${suffix}.com.ng`, 'com')).toMatchObject({ success: true, data: { offer: { free: false } } });
  });

  it('suggests close .com.ng names when it’s taken, and never sells on a guess', async () => {
    as(yearly);
    registry.taken.add(`taken${suffix}.com.ng`);
    const r = await domains.searchDomain(`taken${suffix}`, 'com.ng');
    if (!r.success || r.data.available) throw new Error('expected taken');
    expect(r.data.suggestions.length).toBeGreaterThan(0);
    expect(r.data.suggestions.every((s) => s.domain.endsWith('.com.ng'))).toBe(true);

    registry.down = true;
    expect(await domains.searchDomain(`any${suffix}`, 'com.ng')).toMatchObject({ success: false, error: expect.stringMatching(/registry/) });
  });

  it('is refused while .com.ng isn’t on sale', async () => {
    as(yearly);
    await setPrices(null, null);
    expect(await domains.searchDomain(`ada${suffix}.com.ng`, 'com.ng')).toMatchObject({ success: false, error: expect.stringMatching(/\.com addresses/) });
  });
});

describe('claiming it', () => {
  it('goes straight to the staff queue, free, and becomes the shop’s pending domain', async () => {
    as(yearly);
    const name = `claim${suffix}.com.ng`;
    expect(await domains.claimFreeDomain(name)).toEqual({ success: true, data: { domain: name } });

    const order = await prisma.domainOrder.findFirstOrThrow({ where: { organizationId: yearly.id } });
    expect(order).toMatchObject({ type: 'REGISTER', domain: name, isFree: true, status: 'PENDING_FULFILLMENT', billingTransactionId: null });
    expect(Number(order.ngnPrice)).toBe(0);
    expect(order.readyAt).toBeInstanceOf(Date);
    expect(await prisma.shopDomain.findUnique({ where: { organizationId: yearly.id } })).toMatchObject({ hostname: name, source: 'REGISTERED', status: 'PENDING' });
    expect(await freeDomainStatus(yearly.id)).toEqual({ kind: 'claimed' });

    session.userId = staffId;
    const queue = await staff.listDomainQueue({ tab: 'WAITING' });
    if (!queue.success) throw new Error(queue.error);
    expect(queue.data.rows.find((r) => r.id === order.id)).toMatchObject({ isFree: true, type: 'REGISTER' });
    const detail = await staff.getDomainOrder(order.id);
    expect(detail).toMatchObject({ success: true, data: { isFree: true, registrar: 'QServers', paid: null } });

    // A free registration in progress can't be dropped by accident.
    session.userId = '';
    as(yearly);
    expect(await domains.removeDomain()).toMatchObject({ success: false, error: expect.stringMatching(/registering/) });
  });

  it('is one per shop, even when two presses race', async () => {
    as(yearly);
    await reset(yearly);
    const [a, b] = await Promise.all([domains.claimFreeDomain(`race-a${suffix}.com.ng`), domains.claimFreeDomain(`race-b${suffix}.com.ng`)]);
    expect([a.success, b.success].filter(Boolean)).toHaveLength(1);
    expect(await prisma.domainOrder.count({ where: { organizationId: yearly.id, isFree: true } })).toBe(1);

    // And after its domain is removed, there's no second one.
    await prisma.domainOrder.updateMany({ where: { organizationId: yearly.id }, data: { status: 'ACTIVE' } });
    await prisma.shopDomain.update({ where: { organizationId: yearly.id }, data: { status: 'DISCONNECTED' } });
    expect(await domains.claimFreeDomain(`again${suffix}.com.ng`)).toMatchObject({ success: false, error: expect.stringMatching(/already used/) });
  });

  it('is refused for monthly, trial and plans without it, for a .com, and for a taken name', async () => {
    as(monthly);
    expect(await domains.claimFreeDomain(`m${suffix}.com.ng`)).toMatchObject({ success: false, error: expect.stringMatching(/yearly/) });
    as(trial);
    expect(await domains.claimFreeDomain(`t${suffix}.com.ng`)).toMatchObject({ success: false, error: expect.stringMatching(/doesn’t include/) });
    as(noFeature);
    expect(await domains.claimFreeDomain(`n${suffix}.com.ng`)).toMatchObject({ success: false, error: expect.stringMatching(/doesn’t include/) });

    await reset(yearly);
    as(yearly);
    expect(await domains.claimFreeDomain(`dotcom${suffix}.com`)).toMatchObject({ success: false, error: expect.stringMatching(/\.com\.ng/) });
    registry.taken.add(`gone${suffix}.com.ng`);
    expect(await domains.claimFreeDomain(`gone${suffix}.com.ng`)).toMatchObject({ success: false, error: expect.stringMatching(/taken/) });
    expect(await freeDomainStatus(yearly.id)).toEqual({ kind: 'available' });
  });

  it('comes back when staff couldn’t register it, so the shop can choose another name', async () => {
    as(yearly);
    await reset(yearly);
    expect(await domains.claimFreeDomain(`first${suffix}.com.ng`)).toMatchObject({ success: true });
    const order = await prisma.domainOrder.findFirstOrThrow({ where: { organizationId: yearly.id, isFree: true } });

    session.userId = staffId;
    expect(await staff.markDomainFailed(order.id, 'Someone registered this name at the registry minutes before us.')).toEqual({ success: true, data: undefined });
    expect(await freeDomainStatus(yearly.id)).toEqual({ kind: 'available' });

    session.userId = '';
    expect(await domains.claimFreeDomain(`second${suffix}.com.ng`)).toMatchObject({ success: true });
  });
});

describe('buying a .com.ng', () => {
  it('charges the console price, with no dollar price, and renews at the console renewal price', async () => {
    as(monthly);
    await reset(monthly);
    const r = await domains.buyDomain(`paid${suffix}.com.ng`);
    expect(r).toMatchObject({ success: true, data: { authorizationUrl: expect.stringContaining('paystack.test') } });
    const order = await prisma.domainOrder.findFirstOrThrow({ where: { organizationId: monthly.id }, include: { billingTransaction: true } });
    expect(order).toMatchObject({ type: 'REGISTER', domain: `paid${suffix}.com.ng`, isFree: false, usdPrice: null, exchangeRate: null });
    expect(Number(order.ngnPrice)).toBe(15000);
    expect(Number(order.billingTransaction?.amount)).toBe(15000);

    // Registered and live: renewing charges the renewal price.
    await prisma.billingTransaction.update({ where: { id: order.billingTransactionId! }, data: { status: 'SUCCESS' } });
    await prisma.domainOrder.update({ where: { id: order.id }, data: { status: 'ACTIVE' } });
    await prisma.shopDomain.create({
      data: { organizationId: monthly.id, hostname: `paid${suffix}.com.ng`, canonicalHost: `www.paid${suffix}.com.ng`, source: 'REGISTERED', status: 'LIVE', expiresAt: new Date(Date.now() + 20 * 86400_000) },
    });
    expect(await domains.renewDomain()).toMatchObject({ success: true });
    const renewal = await prisma.domainOrder.findFirstOrThrow({ where: { organizationId: monthly.id, type: 'RENEW' } });
    expect(Number(renewal.ngnPrice)).toBe(18000);
  });
});
