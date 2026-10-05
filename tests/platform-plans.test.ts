/*
 * Plans and pricing in the platform console (ROADMAP 11.7), against the real
 * database. The catalogue and settings are shared with every other test and
 * the dev app, so whatever this changes is put back afterwards.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { dropBilling } from './helpers/plans';
import type { PlanDraft } from '@/lib/billing/plan-edit';

const session = vi.hoisted(() => ({ userId: '' }));
vi.mock('@/lib/auth', () => ({ auth: async () => (session.userId ? { user: { id: session.userId } } : null) }));
vi.mock('@/lib/organization', () => ({
  getOrganizationContext: vi.fn(async () => {
    throw new Error('no request context in this test');
  }),
}));

const plans = await import('@/features/platform/plans');
const settingsActions = await import('@/features/platform/billing-settings');
const { entitlementsFor } = await import('@/lib/billing/workspace-access');
const { listPlansForSale } = await import('@/lib/billing/catalogue');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DAY = 24 * 60 * 60 * 1000;
let staffId = '';
let merchantId = '';
let orgId = '';
const createdPlanIds: string[] = [];
let savedPlans: { id: string; sortOrder: number; highlighted: boolean }[] = [];
let savedSettings: { key: string; value: string }[] = [];

const draft = (over: Partial<PlanDraft> = {}): PlanDraft => ({
  name: `Test Growth ${suffix}`,
  tagline: 'For testing',
  monthlyPrice: 20000,
  discounts: { BIANNUAL: 10, YEARLY: 17 },
  features: ['inventory.module', 'sales.module', 'reports.advanced'],
  maxSeats: 10,
  maxWarehouses: 2,
  highlighted: false,
  ...over,
});

async function create(over: Partial<PlanDraft> = {}) {
  const result = await plans.createPlan(draft(over));
  if (!result.success) throw new Error(result.error);
  createdPlanIds.push(result.data.planId);
  return result.data.planId;
}

beforeAll(async () => {
  staffId = (await prisma.user.create({ data: { name: 'Plans Staff', email: `plans-staff-${suffix}@example.com`, isPlatformStaff: true } })).id;
  merchantId = (await prisma.user.create({ data: { email: `plans-merchant-${suffix}@example.com` } })).id;
  orgId = (await prisma.organization.create({ data: { name: 'Plans Test', slug: `__test-plans-${suffix}` } })).id;
  savedPlans = await prisma.billingPlan.findMany({ select: { id: true, sortOrder: true, highlighted: true } });
  savedSettings = await prisma.platformSetting.findMany({
    where: { key: { in: ['trial_days', 'trial_plan_key', 'grace_days', 'usd_to_ngn_rate'] } },
    select: { key: true, value: true },
  });
});

afterAll(async () => {
  await dropBilling(orgId);
  await prisma.organization.delete({ where: { id: orgId } });
  for (const id of createdPlanIds) {
    await prisma.billingPlanCode.deleteMany({ where: { planId: id } });
    await prisma.billingPlan.deleteMany({ where: { id } });
  }
  for (const p of savedPlans) {
    await prisma.billingPlan.update({ where: { id: p.id }, data: { sortOrder: p.sortOrder, highlighted: p.highlighted } });
  }
  await prisma.platformSetting.deleteMany({ where: { key: { in: ['trial_days', 'trial_plan_key', 'grace_days', 'usd_to_ngn_rate'] } } });
  if (savedSettings.length) await prisma.platformSetting.createMany({ data: savedSettings });
  await prisma.platformAuditLog.deleteMany({ where: { userId: staffId } });
  await prisma.user.deleteMany({ where: { id: { in: [staffId, merchantId] } } });
});

describe('who can use it', () => {
  it('refuses anyone who isn’t platform staff', async () => {
    session.userId = merchantId;
    expect(await plans.listConsolePlans()).toMatchObject({ success: false, error: expect.stringMatching(/platform staff/) });
    expect(await plans.createPlan(draft())).toMatchObject({ success: false });
    expect(await settingsActions.updateBillingSettings({ trialDays: 1, trialPlanId: '', graceDays: 1, usdToNgnRate: 1, mobileAppSetupFee: null, mobileAppYearlyFee: null, mobileAppGraceDays: 14 })).toMatchObject({
      success: false,
      error: expect.stringMatching(/platform staff/),
    });
  });
});

describe('plans', () => {
  it('creates a plan off sale, with each cycle priced and the change recorded', async () => {
    session.userId = staffId;
    const id = await create();
    const row = await prisma.billingPlan.findUniqueOrThrow({ where: { id }, include: { prices: true, features: true } });
    expect(row.isOnSale).toBe(false);
    expect(row.key).toMatch(/^test-growth-/);
    expect(Object.fromEntries(row.prices.map((p) => [p.billingCycle, Number(p.amount)]))).toEqual({
      MONTHLY: 20000,
      BIANNUAL: 108000,
      YEARLY: 199200,
    });
    expect(row.features.map((f) => f.feature).sort()).toEqual(['inventory.module', 'reports.advanced', 'sales.module']);
    expect((await listPlansForSale()).some((p) => p.id === id)).toBe(false);

    const audit = await prisma.platformAuditLog.findFirstOrThrow({ where: { entityId: id, action: 'platform.plan.created' } });
    expect(audit.userId).toBe(staffId);
  });

  it('refuses a bad draft with errors per field', async () => {
    session.userId = staffId;
    const result = await plans.createPlan(draft({ name: '', monthlyPrice: 10, features: ['api.access'] as never }));
    expect(result).toMatchObject({ success: false });
    if (!result.success) expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(['features', 'monthlyPrice', 'name']);
  });

  it('reprices for new subscribers only, recording before and after', async () => {
    session.userId = staffId;
    const id = createdPlanIds[0];
    await prisma.subscription.create({
      data: { organizationId: orgId, planId: id, status: 'ACTIVE', amount: 20000, billingCycle: 'MONTHLY', currentPeriodEnd: new Date(Date.now() + 20 * DAY) },
    });

    const result = await plans.updatePlan(id, draft({ monthlyPrice: 25000 }));
    expect(result).toMatchObject({ success: true, data: { pricesChanged: true } });

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
    expect(Number(sub.amount)).toBe(20000);
    const audit = await prisma.platformAuditLog.findFirstOrThrow({
      where: { entityId: id, action: 'platform.plan.updated' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.metadata).toMatchObject({
      changes: { monthlyPrice: { before: 20000, after: 25000 } },
      prices: { before: expect.any(Array), after: expect.any(Array) },
    });
  });

  it('asks before taking a feature from workspaces, then takes it on their next request', async () => {
    session.userId = staffId;
    const id = createdPlanIds[0];
    expect((await entitlementsFor(orgId)).plan.features).toContain('reports.advanced');

    const withoutReports = draft({ monthlyPrice: 25000, features: ['inventory.module', 'sales.module'] });
    const unconfirmed = await plans.updatePlan(id, withoutReports);
    expect(unconfirmed).toMatchObject({ success: false, needsConfirmation: true, error: expect.stringMatching(/1 workspace/) });
    expect((await entitlementsFor(orgId)).plan.features).toContain('reports.advanced');

    const confirmed = await plans.updatePlan(id, withoutReports, { confirmFeatureRemoval: true });
    expect(confirmed).toMatchObject({ success: true, data: { removed: ['reports.advanced'] } });
    expect((await entitlementsFor(orgId)).plan.features).not.toContain('reports.advanced');
  }, 60_000);

  it('keeps one plan marked popular', async () => {
    session.userId = staffId;
    const id = createdPlanIds[0];
    await plans.updatePlan(id, draft({ monthlyPrice: 25000, features: ['inventory.module', 'sales.module'], highlighted: true }));
    const highlighted = await prisma.billingPlan.findMany({ where: { highlighted: true }, select: { id: true } });
    expect(highlighted).toEqual([{ id }]);
  });

  it('moves a plan through the order', async () => {
    session.userId = staffId;
    const id = createdPlanIds[0];
    const order = async () => (await prisma.billingPlan.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true } })).map((p) => p.id);
    const before = await order();
    const at = before.indexOf(id);
    expect(await plans.movePlan(id, 'up')).toMatchObject({ success: true });
    expect((await order()).indexOf(id)).toBe(Math.max(0, at - 1));
  });

  it('puts a plan on sale and takes it off, but never the trial’s plan', async () => {
    session.userId = staffId;
    const id = createdPlanIds[0];
    expect(await plans.setPlanOnSale(id, true)).toMatchObject({ success: true });
    expect((await listPlansForSale()).some((p) => p.id === id)).toBe(true);

    const trialPlanKey = (await prisma.platformSetting.findUnique({ where: { key: 'trial_plan_key' } }))?.value ?? 'pro';
    const trialPlan = await prisma.billingPlan.findUniqueOrThrow({ where: { key: trialPlanKey } });
    expect(await plans.setPlanOnSale(trialPlan.id, false)).toMatchObject({ success: false, error: expect.stringMatching(/free trial/) });

    expect(await plans.setPlanOnSale(id, false)).toMatchObject({ success: true });
    // Its subscriber keeps it.
    expect((await entitlementsFor(orgId)).plan.id).toBe(id);
  });

  it('deletes only a plan nobody has used', async () => {
    session.userId = staffId;
    expect(await plans.deletePlan(createdPlanIds[0])).toMatchObject({ success: false, error: expect.stringMatching(/Take it off sale/) });
    const unused = await create({ name: `Unused ${suffix}` });
    expect((await plans.getConsolePlan(unused)).success && (await plans.getConsolePlan(unused))).toMatchObject({ data: { deletable: true } });
    expect(await plans.deletePlan(unused)).toMatchObject({ success: true });
    expect(await prisma.billingPlan.findUnique({ where: { id: unused } })).toBeNull();
  });
});

describe('billing settings', () => {
  it('saves the trial, grace and rate together, recording only what changed', async () => {
    session.userId = staffId;
    const current = await settingsActions.getConsoleBillingSettings();
    if (!current.success) throw new Error(current.error);
    const result = await settingsActions.updateBillingSettings({
      trialDays: 7,
      trialPlanId: current.data.plans[0].id,
      graceDays: 0,
      usdToNgnRate: current.data.usdToNgnRate,
      mobileAppSetupFee: current.data.mobileAppSetupFee,
      mobileAppYearlyFee: current.data.mobileAppYearlyFee,
      mobileAppGraceDays: current.data.mobileAppGraceDays,
    });
    expect(result).toMatchObject({ success: true });
    const after = await settingsActions.getConsoleBillingSettings();
    expect(after).toMatchObject({ success: true, data: { trialDays: 7, graceDays: 0, trialPlanId: current.data.plans[0].id } });

    const audit = await prisma.platformAuditLog.findFirstOrThrow({
      where: { action: 'platform.settings.updated', userId: staffId },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.metadata).toMatchObject({ after: { trialDays: 7, graceDays: 0 } });
    expect((audit.metadata as { after: Record<string, unknown> }).after).not.toHaveProperty('usdToNgnRate');
  });

  it('refuses days out of range and a trial plan that isn’t on sale', async () => {
    session.userId = staffId;
    const offSale = createdPlanIds[0]; // taken off sale above
    const result = await settingsActions.updateBillingSettings({ trialDays: 400, trialPlanId: offSale, graceDays: -1, usdToNgnRate: 0, mobileAppSetupFee: null, mobileAppYearlyFee: null, mobileAppGraceDays: 14 });
    expect(result).toMatchObject({ success: false });
    if (!result.success) expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(['graceDays', 'trialDays', 'trialPlanId', 'usdToNgnRate']);
  });
});
