/*
 * Merchants (ROADMAP 11.2) and suspend/restore (11.4) in the platform
 * console, against the real database. Email is captured, not sent.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { dropBilling } from './helpers/plans';
import { SYSTEM_ROLES } from '@/lib/permissions';

const session = vi.hoisted(() => ({ userId: '' }));
vi.mock('@/lib/auth', () => ({ auth: async () => (session.userId ? { user: { id: session.userId } } : null) }));
vi.mock('@/lib/organization', () => ({
  getOrganizationContext: vi.fn(async () => {
    throw new Error('no request context in this test');
  }),
}));
const emails = vi.hoisted(() => [] as { to: string[]; outcome: string; reason?: string | null }[]);
vi.mock('@/lib/email', () => ({
  sendWorkspaceSuspensionEmail: async (p: { to: string[]; outcome: string; reason?: string | null }) => {
    emails.push(p);
  },
}));

const merchants = await import('@/features/platform/merchants');
const { getOrgStatus } = await import('@/lib/tenant/org-status');
const { placeOrder } = await import('@/lib/storefront/orders/create');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tag = `Merchtest ${suffix}`;
const DAY = 24 * 60 * 60 * 1000;
let staffId = '';
let ownerId = '';
let busyId = '';
let quietId = '';

beforeAll(async () => {
  staffId = (await prisma.user.create({ data: { name: 'Console Staff', email: `m-staff-${suffix}@example.com`, isPlatformStaff: true } })).id;
  ownerId = (await prisma.user.create({ data: { name: 'Owner', email: `m-owner-${suffix}@example.com` } })).id;

  const busy = await prisma.organization.create({ data: { name: `${tag} Busy`, slug: `__test-merch-busy-${suffix}` } });
  const quiet = await prisma.organization.create({ data: { name: `${tag} Quiet`, slug: `__test-merch-quiet-${suffix}` } });
  busyId = busy.id;
  quietId = quiet.id;

  const role = await prisma.role.create({ data: { organizationId: busyId, name: SYSTEM_ROLES.OWNER.name, isSystem: true } });
  await prisma.membership.create({ data: { userId: ownerId, organizationId: busyId, roleId: role.id, status: 'ACTIVE' } });

  // Busy: paying, one store, an order and an online payment this month.
  await prisma.subscription.create({
    data: { organizationId: busyId, status: 'ACTIVE', billingCycle: 'MONTHLY', amount: 5000, currentPeriodEnd: new Date(Date.now() + 20 * DAY) },
  });
  await prisma.warehouse.create({ data: { organizationId: busyId, name: 'Main' } });
  const order = await prisma.order.create({
    data: { organizationId: busyId, reference: `MT-${suffix}`, paymentMethod: 'card', subtotal: 12000, totalAmount: 12000 },
  });
  await prisma.orderPayment.create({
    data: {
      organizationId: busyId,
      orderId: order.id,
      provider: 'paystack',
      reference: `mt-pay-${suffix}`,
      status: 'SUCCESS',
      amount: 12000,
      currency: 'NGN',
      returnUrl: 'https://example.com',
      verifiedAt: new Date(),
    },
  });
  // Quiet: a trial.
  await prisma.subscription.create({
    data: { organizationId: quietId, status: 'TRIALING', trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 5 * DAY) },
  });
});

afterAll(async () => {
  for (const id of [busyId, quietId]) {
    await prisma.orderPayment.deleteMany({ where: { organizationId: id } });
    await prisma.order.deleteMany({ where: { organizationId: id } });
    await prisma.warehouse.deleteMany({ where: { organizationId: id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: id } });
    await prisma.membership.deleteMany({ where: { organizationId: id } });
    await prisma.role.deleteMany({ where: { organizationId: id } });
    await dropBilling(id);
    await prisma.organization.delete({ where: { id } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [staffId, ownerId] } } });
});

describe('who can use it', () => {
  it('refuses anyone who isn’t platform staff', async () => {
    session.userId = ownerId;
    expect(await merchants.listMerchants({})).toMatchObject({ success: false, error: expect.stringMatching(/platform staff/) });
    expect(await merchants.getMerchant(busyId)).toMatchObject({ success: false });
    expect(await merchants.suspendOrganization(busyId, 'A reason that is long enough')).toMatchObject({ success: false });
    expect(await merchants.restoreOrganization(busyId)).toMatchObject({ success: false });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: busyId } })).status).toBe('ACTIVE');
  });
});

describe('the merchant list', () => {
  it('finds merchants by name, owner email or web address, with this month’s figures', async () => {
    session.userId = staffId;
    const byName = await merchants.listMerchants({ q: tag });
    if (!byName.success) throw new Error(byName.error);
    expect(byName.data.rows.map((r) => r.id).sort()).toEqual([busyId, quietId].sort());

    const busy = byName.data.rows.find((r) => r.id === busyId)!;
    expect(busy).toMatchObject({
      ownerEmail: `m-owner-${suffix}@example.com`,
      planState: 'active',
      stores: 1,
      ordersThisMonth: 1,
      takingsThisMonth: 12000,
      verificationStatus: 'UNVERIFIED',
    });

    const byEmail = await merchants.listMerchants({ q: `m-owner-${suffix}` });
    expect(byEmail.success && byEmail.data.rows.map((r) => r.id)).toEqual([busyId]);
    const bySlug = await merchants.listMerchants({ q: `__test-merch-quiet-${suffix}` });
    expect(bySlug.success && bySlug.data.rows.map((r) => r.id)).toEqual([quietId]);
  });

  it('filters by plan state', async () => {
    session.userId = staffId;
    const trials = await merchants.listMerchants({ q: tag, plan: 'trial' });
    expect(trials.success && trials.data.rows.map((r) => r.id)).toEqual([quietId]);
    const paying = await merchants.listMerchants({ q: tag, plan: 'active' });
    expect(paying.success && paying.data.rows.map((r) => r.id)).toEqual([busyId]);
  });

  it('shows one merchant’s members, figures and history', async () => {
    session.userId = staffId;
    const result = await merchants.getMerchant(busyId);
    if (!result.success || !result.data) throw new Error('not found');
    expect(result.data.members).toEqual([expect.objectContaining({ email: `m-owner-${suffix}@example.com`, role: 'Owner' })]);
    expect(result.data.figures).toMatchObject({ stores: 1, ordersThisMonth: 1, takingsThisMonth: 12000, ordersAllTime: 1 });
    expect(result.data.plan).toMatchObject({ state: 'active', amount: 5000 });
  });
});

describe('suspending and restoring', () => {
  it('needs a real reason', async () => {
    session.userId = staffId;
    expect(await merchants.suspendOrganization(busyId, 'bad')).toMatchObject({ success: false, error: expect.stringMatching(/Say why/) });
  });

  it('suspends: closed everywhere, recorded on the merchant’s log, owners told why', async () => {
    session.userId = staffId;
    emails.length = 0;
    const reason = 'Several customers reported orders that were paid for and never sent.';
    expect(await merchants.suspendOrganization(busyId, reason)).toMatchObject({ success: true });

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: busyId } });
    expect(org).toMatchObject({ status: 'SUSPENDED', suspensionReason: reason });
    expect(org.suspendedAt).not.toBeNull();
    expect(await getOrgStatus(org.slug)).toBe('SUSPENDED');

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: busyId, action: 'platform.organization.suspended' } });
    expect(audit).toMatchObject({ userId: staffId, metadata: { reason } });
    expect(emails).toEqual([expect.objectContaining({ to: [`m-owner-${suffix}@example.com`], outcome: 'suspended', reason })]);

    // The shop takes no orders — the data layer agrees with the proxy.
    const placed = await placeOrder({
      organizationSlug: org.slug,
      customerId: null,
      lines: [],
      contact: {} as never,
      address: {} as never,
      deliveryMethodId: '',
      paymentMethodId: '',
      note: '',
      config: {} as never,
    });
    expect(placed).toMatchObject({ ok: false, code: 'store-unavailable' });

    // Listed under Suspended, with its history on the detail page.
    const suspended = await merchants.listMerchants({ q: tag, status: 'suspended' });
    expect(suspended.success && suspended.data.rows.map((r) => r.id)).toEqual([busyId]);
    const detail = await merchants.getMerchant(busyId);
    expect(detail.success && detail.data?.history[0]).toMatchObject({ action: 'platform.organization.suspended', reason, staffName: 'Console Staff' });

    expect(await merchants.suspendOrganization(busyId, reason)).toMatchObject({ success: false, error: expect.stringMatching(/isn’t active/) });
  });

  it('restores: open again, reason cleared, owners told', async () => {
    session.userId = staffId;
    emails.length = 0;
    expect(await merchants.restoreOrganization(busyId)).toMatchObject({ success: true });
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: busyId } });
    expect(org).toMatchObject({ status: 'ACTIVE', suspendedAt: null, suspensionReason: null });
    expect(await getOrgStatus(org.slug)).toBe('ACTIVE');
    expect(emails).toEqual([expect.objectContaining({ outcome: 'restored' })]);
    expect(await prisma.auditLog.count({ where: { organizationId: busyId, action: 'platform.organization.restored' } })).toBe(1);
    expect(await merchants.restoreOrganization(busyId)).toMatchObject({ success: false, error: expect.stringMatching(/isn’t suspended/) });
  });
});
