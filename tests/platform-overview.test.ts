/*
 * The console's overview figures (ROADMAP 11.0), against the real database.
 * The dev database is shared, so each figure is checked as a change: adding
 * one workspace in each plan state moves each count by exactly one.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { dropBilling } from './helpers/plans';

const session = vi.hoisted(() => ({ userId: '' }));
vi.mock('@/lib/auth', () => ({ auth: async () => (session.userId ? { user: { id: session.userId } } : null) }));

const { getConsoleOverview, pendingVerificationCount } = await import('@/features/platform/overview');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DAY = 24 * 60 * 60 * 1000;
const orgIds: string[] = [];
let staffId = '';
let merchantId = '';

async function workspace(name: string, subscription?: Record<string, unknown>) {
  const org = await prisma.organization.create({ data: { name, slug: `__test-overview-${name}-${suffix}` } });
  orgIds.push(org.id);
  if (subscription) await prisma.subscription.create({ data: { organizationId: org.id, ...subscription } });
  return org.id;
}

beforeAll(async () => {
  staffId = (await prisma.user.create({ data: { email: `overview-staff-${suffix}@example.com`, isPlatformStaff: true } })).id;
  merchantId = (await prisma.user.create({ data: { email: `overview-merchant-${suffix}@example.com` } })).id;
});

afterAll(async () => {
  for (const id of orgIds) {
    await prisma.merchantPaymentAccount.deleteMany({ where: { organizationId: id } });
    await dropBilling(id);
    await prisma.organization.delete({ where: { id } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [staffId, merchantId] } } });
});

describe('the console overview', () => {
  it('is for platform staff only', async () => {
    session.userId = merchantId;
    await expect(getConsoleOverview()).rejects.toThrow(/platform staff/i);
    await expect(pendingVerificationCount()).rejects.toThrow(/platform staff/i);
  });

  it('counts each workspace in the plan state the merchant sees', async () => {
    session.userId = staffId;
    const before = await getConsoleOverview();
    const now = Date.now();

    await workspace('trial', { status: 'TRIALING', trialStartedAt: new Date(now), trialEndsAt: new Date(now + 5 * DAY) });
    await workspace('paying', { status: 'ACTIVE', currentPeriodEnd: new Date(now + 20 * DAY) });
    await workspace('grace', { status: 'TRIALING', trialEndsAt: new Date(now - DAY), lapsedAt: new Date(now - DAY), graceEndsAt: new Date(now + 5 * DAY) });
    // Ended yesterday, not yet seen by the merchant's side: in grace, nothing recorded.
    const unseen = await workspace('unseen', { status: 'TRIALING', trialEndsAt: new Date(now - DAY) });
    await workspace('closed', { status: 'INCOMPLETE', lapsedAt: new Date(now - DAY), graceEndsAt: new Date(now - DAY) });
    await workspace('none');
    const suspended = await workspace('suspended', { status: 'ACTIVE', currentPeriodEnd: new Date(now + 20 * DAY) });
    await prisma.organization.update({ where: { id: suspended }, data: { status: 'SUSPENDED' } });

    const after = await getConsoleOverview();
    const moved = (k: keyof typeof after.workspaces.byState) => after.workspaces.byState[k] - before.workspaces.byState[k];
    expect({ trial: moved('trial'), active: moved('active'), grace: moved('grace'), lapsed: moved('lapsed'), none: moved('none') }).toEqual({
      trial: 1,
      active: 1,
      grace: 2,
      lapsed: 1,
      none: 1,
    });
    expect(after.workspaces.total - before.workspaces.total).toBe(6);
    expect(after.workspaces.suspended - before.workspaces.suspended).toBe(1);
    expect(after.workspaces.newThisWeek - before.workspaces.newThisWeek).toBe(7);

    // Looking never records a lapse — only the merchant's side does.
    expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: unseen } })).lapsedAt).toBeNull();
  });

  it('counts submissions waiting for review', async () => {
    session.userId = staffId;
    const before = await pendingVerificationCount();
    const orgId = await workspace('pending');
    await prisma.merchantPaymentAccount.create({
      data: { organizationId: orgId, verificationStatus: 'PENDING', submittedAt: new Date() },
    });
    expect(await pendingVerificationCount()).toBe(before + 1);
    expect((await getConsoleOverview()).verification.pending).toBe(before + 1);
  });
});
