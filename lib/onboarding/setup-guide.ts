/*
 * lib/onboarding/setup-guide.ts
 *
 * Where each workspace is with "Get your shop ready" (ROADMAP 12.5), read
 * from the real records — the one function the dashboard's guide, the
 * "Open your shop" check and the platform's merchant list all use. Batched
 * over many workspaces, so the console's list costs a handful of queries,
 * not a handful per row.
 *
 * The definitions it reads are the ones the rest of the app uses: a store
 * that sells online is SELLS_ONLINE_WHERE, one that can deliver is
 * HAS_LIVE_DELIVERY_WHERE, stock that reaches the online shop is at an
 * ONLINE_SUPPLY_WHERE store (lib/storefront/delivery/supply.ts).
 */
import { prisma } from '@/lib/prisma';
import { HAS_LIVE_DELIVERY_WHERE, ONLINE_SUPPLY_WHERE, SELLS_ONLINE_WHERE } from '@/lib/storefront/delivery/supply';
import { isSalesChannels } from './business';
import { summarize, type SetupProgress, type SetupStepKey } from './setup-steps';

const orgIn = (ids: string[]) => ({ organizationId: { in: ids } });

const IN_STOCK_ONLINE = { quantity: { gt: 0 }, warehouse: ONLINE_SUPPLY_WHERE };

export async function setupProgressFor(organizationIds: string[]): Promise<Map<string, SetupProgress>> {
  const ids = [...new Set(organizationIds)];
  if (ids.length === 0) return new Map();

  const distinctOrgs = async (rows: Promise<{ organizationId: string }[]>) => new Set((await rows).map((r) => r.organizationId));

  const [orgs, placed, sellsOnline, delivers, stocked, bankAccounts, pages] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        logoUrl: true,
        storefrontOpen: true,
        customStoreDomain: true,
        salesChannels: true,
        paymentAccount: { select: { verificationStatus: true, setupStatus: true } },
      },
    }),
    distinctOrgs(
      prisma.warehouse.findMany({
        where: { ...orgIn(ids), status: 'ACTIVE', state: { not: null }, city: { not: null } },
        select: { organizationId: true },
        distinct: ['organizationId'],
      }),
    ),
    distinctOrgs(
      prisma.warehouse.findMany({ where: { ...orgIn(ids), ...SELLS_ONLINE_WHERE }, select: { organizationId: true }, distinct: ['organizationId'] }),
    ),
    distinctOrgs(
      prisma.warehouse.findMany({
        where: { ...orgIn(ids), ...SELLS_ONLINE_WHERE, ...HAS_LIVE_DELIVERY_WHERE },
        select: { organizationId: true },
        distinct: ['organizationId'],
      }),
    ),
    distinctOrgs(
      prisma.inventoryItem.findMany({
        where: {
          ...orgIn(ids),
          parentItemId: null,
          isPublished: true,
          status: 'ACTIVE',
          OR: [
            { inventoryLevels: { some: IN_STOCK_ONLINE } },
            { variants: { some: { status: 'ACTIVE', inventoryLevels: { some: IN_STOCK_ONLINE } } } },
          ],
        },
        select: { organizationId: true },
        distinct: ['organizationId'],
      }),
    ),
    distinctOrgs(
      prisma.merchantBankAccount.findMany({ where: { ...orgIn(ids), isActive: true }, select: { organizationId: true }, distinct: ['organizationId'] }),
    ),
    distinctOrgs(
      prisma.storePage.findMany({ where: { ...orgIn(ids), isPublished: true }, select: { organizationId: true }, distinct: ['organizationId'] }),
    ),
  ]);

  const result = new Map<string, SetupProgress>();
  for (const org of orgs) {
    const onlinePayments =
      org.paymentAccount?.verificationStatus === 'VERIFIED' && org.paymentAccount.setupStatus === 'ACTIVE';
    const done: Record<SetupStepKey, boolean> = {
      store_place: placed.has(org.id),
      sells_online: sellsOnline.has(org.id),
      delivery: delivers.has(org.id),
      product: stocked.has(org.id),
      payment: onlinePayments || bankAccounts.has(org.id),
      open: org.storefrontOpen,
      logo: Boolean(org.logoUrl),
      store_pages: pages.has(org.id),
      domain: Boolean(org.customStoreDomain),
    };
    result.set(org.id, summarize(done, isSalesChannels(org.salesChannels) ? org.salesChannels : null));
  }
  return result;
}

/** One workspace's progress, or null if there's no such workspace. */
export async function getSetupProgress(organizationId: string): Promise<SetupProgress | null> {
  return (await setupProgressFor([organizationId])).get(organizationId) ?? null;
}
