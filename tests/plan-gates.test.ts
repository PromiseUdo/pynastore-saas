/*
 * Plan keys that lock what they say (ROADMAP 22.1): custom roles, campaigns,
 * wholesale, the AI shopping assistant and the monthly allowance of
 * AI-written social posts. Each shop here is on a plan of its own
 * (givePlanWith), so the shared catalogue is never touched.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { givePlanWith, dropBilling, dropTestPlan } from './helpers/plans';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Plan Gates', slug: '', logoUrl: null, status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';
import { FEATURES, FEATURE_INFO, notOnPlanMessage } from '@/lib/billing/plans';

const { createRole, updateRole, duplicateRole } = await import('@/features/roles/actions');
const { createCampaign, deleteCampaign } = await import('@/features/marketing/campaigns');
const { saveWholesaleSettings } = await import('@/features/settings/wholesale');
const { getWholesaleSettings, getWholesaleSettingsBySlug } = await import('@/lib/trade/accounts');
const { storeHasFeature, workspaceHasFeature } = await import('@/lib/billing/workspace-access');
const { allowanceMonth, nextAllowanceStart, takeCopyAllowance } = await import('@/lib/ai/social/quota');

vi.setConfig({ testTimeout: 60_000 });

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let roleId = '';

/** Moves the test shop onto a plan with exactly these features. */
async function planWith(features: string[]) {
  await dropBilling(ctx.organization.id);
  await dropTestPlan(ctx.organization.id);
  await givePlanWith(ctx.organization.id, features);
}

const wholesaleInput = (mode: 'OFF' | 'RETAIL_AND_TRADE') => ({
  mode,
  requestsOpen: false,
  tradePayOnline: true,
  tradePayTransfer: true,
  tradePayOnDelivery: true,
  vatAdded: false,
  minOrderValue: null,
});

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: 'Plan Gates', slug: `__test-plan-gates-${suffix}`, wholesaleMode: 'RETAIL_AND_TRADE' },
  });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = [
    PERMISSIONS.ROLE_MANAGE,
    PERMISSIONS.SALES_DISCOUNT_MANAGE,
    PERMISSIONS.SETTINGS_EDIT,
    PERMISSIONS.SALES_VIEW,
  ];
  roleId = (await prisma.role.create({ data: { organizationId: org.id, name: 'Packer', isSystem: false } })).id;
});

afterAll(async () => {
  const organizationId = ctx.organization.id;
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.campaign.deleteMany({ where: { organizationId } });
  await prisma.role.deleteMany({ where: { organizationId } });
  await dropBilling(organizationId);
  await dropTestPlan(organizationId);
  await prisma.organization.delete({ where: { id: organizationId } });
});

describe('the registry', () => {
  it('sells the three new keys and no longer has "More than one store"', () => {
    for (const key of ['marketing.campaigns', 'sales.wholesale', 'storefront.ai_shopping']) {
      expect(FEATURE_INFO).toHaveProperty(key);
    }
    expect(FEATURE_INFO).not.toHaveProperty('inventory.multi_warehouse');
  });
});

describe('custom roles', () => {
  it('without it: no new or duplicated roles, no permission changes — renaming still works', async () => {
    await planWith([]);
    const locked = notOnPlanMessage(FEATURES.CUSTOM_ROLES);

    expect(await createRole({ name: 'Cashier', permissionKeys: [] })).toEqual({ success: false, error: locked });
    expect(await duplicateRole(roleId, 'Packer copy')).toEqual({ success: false, error: locked });
    expect(await updateRole({ roleId, permissionKeys: [PERMISSIONS.SALES_VIEW] })).toEqual({ success: false, error: locked });

    // Sending the permissions it already has is not a change.
    expect((await updateRole({ roleId, permissionKeys: [] })).success).toBe(true);
    expect((await updateRole({ roleId, name: 'Packers' })).success).toBe(true);
  });

  it('with it: roles can be made and changed', async () => {
    await planWith([FEATURES.CUSTOM_ROLES]);
    expect((await createRole({ name: 'Cashier', permissionKeys: [] })).success).toBe(true);
    expect((await updateRole({ roleId, permissionKeys: [PERMISSIONS.SALES_VIEW] })).success).toBe(true);
  });
});

describe('campaigns', () => {
  const input = () => ({
    name: `Sale ${suffix}`,
    mechanic: 'PERCENT_OFF' as const,
    value: 10,
    startsAt: new Date(Date.now() + 86_400_000),
    endsAt: null,
    targetKind: 'STORE' as const,
    targetIds: [],
  });

  it('without it: none can be started, but one the shop already has can still be deleted', async () => {
    await planWith([FEATURES.SALES_MODULE]);
    expect(await createCampaign(input())).toEqual({ success: false, error: notOnPlanMessage(FEATURES.CAMPAIGNS) });

    const existing = await prisma.campaign.create({
      data: { organizationId: ctx.organization.id, ...input(), status: 'DRAFT' },
      select: { id: true },
    });
    expect((await deleteCampaign(existing.id)).success).toBe(true);
  });

  it('with it: a campaign can be created', async () => {
    await planWith([FEATURES.SALES_MODULE, FEATURES.CAMPAIGNS]);
    expect((await createCampaign(input())).success).toBe(true);
  });
});

describe('wholesale', () => {
  it('without it: off everywhere, with the merchant’s choice kept, and it can’t be turned on', async () => {
    await planWith([]);
    const settings = await getWholesaleSettings(ctx.organization.id);
    expect(settings).toMatchObject({ mode: 'OFF', chosenMode: 'RETAIL_AND_TRADE', onPlan: false, requestsOpen: false });
    expect((await getWholesaleSettingsBySlug(ctx.organization.slug)).mode).toBe('OFF');

    expect(await saveWholesaleSettings(wholesaleInput('RETAIL_AND_TRADE'))).toEqual({
      success: false,
      error: notOnPlanMessage(FEATURES.WHOLESALE),
    });
    // Turning it off never needs the plan.
    expect((await saveWholesaleSettings(wholesaleInput('OFF'))).success).toBe(true);
  });

  it('with it: the merchant’s choice applies again', async () => {
    await planWith([FEATURES.WHOLESALE]);
    expect((await saveWholesaleSettings(wholesaleInput('RETAIL_AND_TRADE'))).success).toBe(true);
    expect(await getWholesaleSettings(ctx.organization.id)).toMatchObject({ mode: 'RETAIL_AND_TRADE', onPlan: true });
    expect((await getWholesaleSettingsBySlug(ctx.organization.slug)).mode).toBe('RETAIL_AND_TRADE');
  });
});

describe('the AI shopping assistant and search by photo', () => {
  it('is on only for a shop whose plan includes it', async () => {
    await planWith([]);
    expect(await storeHasFeature(ctx.organization.slug, FEATURES.AI_SHOPPING)).toBe(false);
    await planWith([FEATURES.AI_SHOPPING]);
    expect(await storeHasFeature(ctx.organization.slug, FEATURES.AI_SHOPPING)).toBe(true);
    expect(await workspaceHasFeature(ctx.organization.id, FEATURES.AI_SHOPPING)).toBe(true);
    expect(await storeHasFeature(`__no-such-shop-${suffix}`, FEATURES.AI_SHOPPING)).toBe(false);
  });
});

describe('the monthly allowance of AI-written posts', () => {
  const nov = new Date('2026-11-14T10:00:00Z');

  it('counts to the plan’s number, then says it’s used up', async () => {
    const org = `allowance-${suffix}`;
    expect(await takeCopyAllowance(org, 2, nov)).toEqual({ ok: true });
    expect(await takeCopyAllowance(org, 2, nov)).toEqual({ ok: true });
    expect(await takeCopyAllowance(org, 2, nov)).toEqual({ ok: false, reason: 'used-up', limit: 2 });
    // A new Lagos month is a new allowance.
    expect(await takeCopyAllowance(org, 2, new Date('2026-12-02T10:00:00Z'))).toEqual({ ok: true });
  });

  it('0 means none on the plan, and null means no monthly cap', async () => {
    expect(await takeCopyAllowance(`none-${suffix}`, 0, nov)).toEqual({ ok: false, reason: 'not-on-plan', limit: 0 });
    for (let i = 0; i < 5; i++) expect(await takeCopyAllowance(`open-${suffix}`, null, nov)).toEqual({ ok: true });
  });

  it('runs on Lagos months', () => {
    // 23:30 UTC on 30 November is already 1 December in Lagos.
    expect(allowanceMonth(new Date('2026-11-30T23:30:00Z'))).toBe('2026-12');
    expect(allowanceMonth(nov)).toBe('2026-11');
    expect(nextAllowanceStart(nov).toISOString()).toBe('2026-11-30T23:00:00.000Z');
  });
});
