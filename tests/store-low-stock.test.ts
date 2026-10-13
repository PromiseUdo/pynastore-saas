/*
 * Low stock, per store (ROADMAP Phase 8.3): whose reorder point decides,
 * where the alert points and who gets it (18.6: the list, store access, one
 * summary email a day), and that restocking suggestions can be narrowed to
 * the store that actually ran low.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Low Stock Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));

const sentEmails = vi.hoisted(() => ({ summaries: [] as { to: string | string[]; list?: string[]; button?: { url: string } }[] }));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));
vi.mock('@/lib/email', () => ({
  sendPlatformNoticeEmail: async (payload: { to: string | string[]; list?: string[]; button?: { url: string } }) => {
    sentEmails.summaries.push(payload);
    return true;
  },
}));

const { maybeSendLowStockAlert } = await import('@/features/inventory/shared');
const { getLowStockLevels } = await import('@/features/inventory/reports');
const { previewReorderDrafts } = await import('@/features/procurement/auto-reorder');
const { sendDailyDigests } = await import('@/lib/notifications/digest');

let lagos = '';
let portHarcourt = '';
let supplier = '';
let otherStore = '';
let otherOrgId = '';

beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({ data: { name: 'Low Stock Test', slug: `__test-lowstock-${stamp}` } });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.PROCUREMENT_VIEW];

  lagos = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Lagos' } })).id;
  portHarcourt = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Port Harcourt' } })).id;
  supplier = (await prisma.supplier.create({ data: { organizationId: org.id, name: 'Kano Wholesale' } })).id;

  const other = await prisma.organization.create({ data: { name: 'Other', slug: `__test-lowstock-other-${stamp}` } });
  otherOrgId = other.id;
  otherStore = (await prisma.warehouse.create({ data: { organizationId: other.id, name: 'Somebody else' } })).id;

  // The product asks to be warned at 5 and to bring in 20.
  const airmax = await prisma.inventoryItem.create({
    data: { organizationId: org.id, sku: 'AIRMAX', name: 'Nike Air Max', reorderPoint: 5, averageCost: 20000, preferredSupplierId: supplier },
  });
  // Lagos wants warning earlier (10) and a bigger delivery (30).
  await prisma.inventoryLevel.create({
    data: { inventoryItemId: airmax.id, warehouseId: lagos, quantity: 8, reorderPoint: 10, reorderQty: 30 },
  });
  // Port Harcourt uses the product's 5, and 8 is above it.
  await prisma.inventoryLevel.create({ data: { inventoryItemId: airmax.id, warehouseId: portHarcourt, quantity: 8 } });

  // Low in Port Harcourt only, and with no supplier — so it can't be reordered.
  const mug = await prisma.inventoryItem.create({
    data: { organizationId: org.id, sku: 'MUG', name: 'Enamel Mug', reorderPoint: 4, averageCost: 2500 },
  });
  await prisma.inventoryLevel.create({ data: { inventoryItemId: mug.id, warehouseId: portHarcourt, quantity: 2 } });
});

beforeEach(async () => {
  sentEmails.summaries.length = 0;
  await prisma.notificationEvent.deleteMany({ where: { organizationId: ctx.organization.id } });
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.pOLineItem.deleteMany({ where: { purchaseOrder: { organizationId } } });
    await prisma.purchaseOrder.deleteMany({ where: { organizationId } });
    await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId } });
    await prisma.supplier.deleteMany({ where: { organizationId } });
    await prisma.warehouse.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

describe('the threshold in force is the store’s', () => {
  it('reports the same product as low in one store and fine in another', async () => {
    const all = await getLowStockLevels();
    const atLagos = await getLowStockLevels(lagos);
    const atPortHarcourt = await getLowStockLevels(portHarcourt);
    if (!all.success || !atLagos.success || !atPortHarcourt.success) throw new Error('expected three reads');

    // Lagos: 8 against its own 10. Port Harcourt: 8 against the product's 5 — fine.
    expect(atLagos.data.map((r) => r.sku)).toEqual(['AIRMAX']);
    expect(atLagos.data[0]).toMatchObject({ reorderPoint: 10, reorderQty: 30 });
    expect(atPortHarcourt.data.map((r) => r.sku)).toEqual(['MUG']);
    expect(all.data.map((r) => r.sku).sort()).toEqual(['AIRMAX', 'MUG']);
  });
});

describe('restocking suggestions for one store', () => {
  it('narrows to the store that ran low, and uses that store’s own quantity', async () => {
    const result = await previewReorderDrafts(lagos);
    if (!result.success) throw new Error(result.error);

    expect(result.data).toHaveLength(1);
    const [group] = result.data;
    expect(group).toMatchObject({ warehouseId: lagos, warehouseName: 'Lagos', supplierName: 'Kano Wholesale' });
    expect(group.items).toHaveLength(1);
    // Lagos asked for 30 rather than the fallback (2 × reorder point − on hand).
    expect(group.items[0]).toMatchObject({ sku: 'AIRMAX', quantity: 30, currentStock: 8, reorderPoint: 10 });
  });

  it('leaves out a low product with no preferred supplier — there is nobody to order from', async () => {
    const result = await previewReorderDrafts(portHarcourt);
    if (!result.success) throw new Error(result.error);
    expect(result.data).toEqual([]);
  });

  it('still covers every store when no store is named', async () => {
    const result = await previewReorderDrafts();
    if (!result.success) throw new Error(result.error);
    expect(result.data.map((g) => g.warehouseId)).toEqual([lagos]);
  });

  it('narrows to nothing for another workspace’s store, rather than widening', async () => {
    const result = await previewReorderDrafts(otherStore);
    expect(result).toEqual({ success: false, error: 'Store not found' });
  });
});

describe('the alert', () => {
  /** A member who may see stock — in every store, or only in `onlyStore`. */
  async function addRecipient(email: string, onlyStore?: string) {
    const permission = await prisma.permission.upsert({
      where: { key: PERMISSIONS.INVENTORY_VIEW },
      create: { key: PERMISSIONS.INVENTORY_VIEW, module: 'inventory', description: 'View inventory' },
      update: {},
    });
    const role = await prisma.role.create({
      data: {
        organizationId: ctx.organization.id,
        name: `Stock keeper ${Math.random().toString(36).slice(2, 6)}`,
        rolePermissions: { create: { permissionId: permission.id } },
      },
    });
    const user = await prisma.user.create({ data: { email, name: 'Keeper' } });
    const membership = await prisma.membership.create({
      data: { organizationId: ctx.organization.id, userId: user.id, roleId: role.id, status: 'ACTIVE' },
    });
    if (onlyStore) await prisma.membershipWarehouse.create({ data: { membershipId: membership.id, warehouseId: onlyStore } });
    return { userId: user.id, roleId: role.id };
  }

  let everywhere: { userId: string; roleId: string };
  let portHarcourtOnly: { userId: string; roleId: string };
  const crossedAtLagos = () =>
    maybeSendLowStockAlert({
      organizationId: ctx.organization.id,
      organizationSlug: ctx.organization.slug,
      itemName: 'Nike Air Max',
      itemSku: 'AIRMAX',
      warehouseId: lagos,
      warehouseName: 'Lagos',
      previousQty: 12,
      newQty: 8,
      threshold: 10,
    });
  const listFor = (userId: string) => prisma.notification.findMany({ where: { userId, organizationId: ctx.organization.id, kind: 'stock.low' } });

  beforeAll(async () => {
    everywhere = await addRecipient(`keeper-${Date.now()}@example.test`);
    portHarcourtOnly = await addRecipient(`ph-keeper-${Date.now()}@example.test`, portHarcourt);
  });

  afterAll(async () => {
    for (const r of [everywhere, portHarcourtOnly]) {
      await prisma.membership.deleteMany({ where: { userId: r.userId } });
      await prisma.user.delete({ where: { id: r.userId } });
      await prisma.rolePermission.deleteMany({ where: { roleId: r.roleId } });
      await prisma.role.delete({ where: { id: r.roleId } });
    }
  });

  it('leads to the store that ran low, and says the reorder point was that store’s own', async () => {
    await crossedAtLagos();
    const [entry] = await listFor(everywhere.userId);
    expect(entry.body).toBe('8 left at Lagos — Lagos’s own reorder point is 10.');
    expect(entry.target).toEqual({ type: 'low-stock', warehouseId: lagos });
    expect(sentEmails.summaries).toEqual([]); // not an email per item
  });

  it('says the product’s reorder point when the store has no override of its own', async () => {
    await maybeSendLowStockAlert({
      organizationId: ctx.organization.id,
      organizationSlug: ctx.organization.slug,
      itemName: 'Enamel Mug',
      itemSku: 'MUG',
      warehouseId: portHarcourt,
      warehouseName: 'Port Harcourt',
      previousQty: 6,
      newQty: 2,
      threshold: 4,
    });
    const [entry] = await listFor(everywhere.userId);
    expect(entry.body).toBe('2 left at Port Harcourt — the product’s reorder point is 4.');
  });

  it('goes only to people who can work in that store', async () => {
    await crossedAtLagos();
    expect(await listFor(everywhere.userId)).toHaveLength(1);
    expect(await listFor(portHarcourtOnly.userId)).toHaveLength(0);
  });

  it('is gathered into one email a day, once, unless already seen', async () => {
    await crossedAtLagos();
    const later = new Date(Date.now() + 60_000);
    await sendDailyDigests({ now: later });
    const mine = sentEmails.summaries.filter((e) => [e.to].flat().some((to) => to.startsWith('keeper-')));
    expect(mine).toHaveLength(1);
    expect(mine[0].list).toEqual(['Low stock: Nike Air Max — 8 left at Lagos — Lagos’s own reorder point is 10.']);
    expect(mine[0].button?.url).toContain('/notifications');

    sentEmails.summaries.length = 0;
    await sendDailyDigests({ now: later });
    expect(sentEmails.summaries).toEqual([]);
  });

  it('stays silent unless the threshold was actually crossed on the way down', async () => {
    const base = {
      organizationId: ctx.organization.id,
      organizationSlug: ctx.organization.slug,
      itemName: 'Nike Air Max',
      itemSku: 'AIRMAX',
      warehouseId: lagos,
      warehouseName: 'Lagos',
    };

    await maybeSendLowStockAlert({ ...base, previousQty: 8, newQty: 7, threshold: 10 }); // already below
    await maybeSendLowStockAlert({ ...base, previousQty: 30, newQty: 20, threshold: 10 }); // still above
    await maybeSendLowStockAlert({ ...base, previousQty: 30, newQty: 20, threshold: null }); // no threshold at all

    expect(await listFor(everywhere.userId)).toEqual([]);
  });
});
