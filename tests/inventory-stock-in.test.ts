/*
 * Recording stock for a product: the "how many do you have?" path used by
 * the opening-stock step and the Add stock dialog.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Stock In Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { recordStockIn, getProductStockUnits } = await import('@/features/inventory/stock');

const ids: Record<string, string> = {};

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: 'Stock In Test', slug: `__test-stockin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  });
  ctx.organization.id = org.id;
  ctx.membership.role.permissions = [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_MOVEMENT_CREATE];

  ids.store = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Lagos' } })).id;

  const simple = await prisma.inventoryItem.create({
    data: { organizationId: org.id, name: 'Travel Mug', sku: 'MUG', slug: 'mug', sellingPrice: 6000 },
  });
  ids.simple = simple.id;

  const tee = await prisma.inventoryItem.create({
    data: {
      organizationId: org.id,
      name: 'Tee',
      sku: 'TEE',
      slug: 'tee',
      sellingPrice: 8000,
      variantOptions: [{ name: 'Colour', kind: 'color', values: [{ label: 'Red' }, { label: 'Navy' }] }],
    },
  });
  ids.tee = tee.id;
  ids.red = (
    await prisma.inventoryItem.create({
      data: {
        organizationId: org.id,
        name: 'Tee (Red)',
        sku: 'TEE-RED',
        itemType: 'VARIANT',
        parentItemId: tee.id,
        variantAttributes: { Colour: 'Red' },
      },
    })
  ).id;
  ids.navy = (
    await prisma.inventoryItem.create({
      data: {
        organizationId: org.id,
        name: 'Tee (Navy)',
        sku: 'TEE-NAVY',
        itemType: 'VARIANT',
        parentItemId: tee.id,
        variantAttributes: { Colour: 'Navy' },
      },
    })
  ).id;
});

afterAll(async () => {
  const organizationId = ctx.organization.id;
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.stockMovement.deleteMany({ where: { organizationId } });
  await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId } } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId, parentItemId: { not: null } } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId } });
  await prisma.warehouse.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
});

function ok<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

describe('recording stock for a product', () => {
  it('offers the product itself when it has no variants, and each variant when it does', async () => {
    const simple = ok(await getProductStockUnits(ids.simple));
    expect(simple.hasVariants).toBe(false);
    expect(simple.units).toEqual([expect.objectContaining({ id: ids.simple, sku: 'MUG' })]);
    expect(simple.hasStock).toBe(false);

    const tee = ok(await getProductStockUnits(ids.tee));
    expect(tee.hasVariants).toBe(true);
    // labelled by what makes them different, not the full product name
    expect(tee.units.map((u) => u.label)).toEqual(['Red', 'Navy']);
  });

  it('records opening stock and leaves a ledger entry saying why', async () => {
    ok(await recordStockIn({ warehouseId: ids.store, notes: 'Opening stock', lines: [{ inventoryItemId: ids.simple, quantity: 12, unitCost: 3000 }] }));

    const level = await prisma.inventoryLevel.findFirstOrThrow({ where: { inventoryItemId: ids.simple, warehouseId: ids.store } });
    expect(Number(level.quantity)).toBe(12);

    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { inventoryItemId: ids.simple } });
    expect(movement).toMatchObject({ type: 'IN', notes: 'Opening stock' });
    expect(Number(movement.quantity)).toBe(12);

    // the cost is what keeps stock value and profit honest
    const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: ids.simple } });
    expect(Number(item.averageCost)).toBe(3000);
  });

  it('records several variants in one go, and adds to what is already there', async () => {
    ok(
      await recordStockIn({
        warehouseId: ids.store,
        lines: [
          { inventoryItemId: ids.red, quantity: 5 },
          { inventoryItemId: ids.navy, quantity: 3 },
        ],
      }),
    );
    ok(await recordStockIn({ warehouseId: ids.store, lines: [{ inventoryItemId: ids.red, quantity: 2 }] }));

    const units = ok(await getProductStockUnits(ids.tee));
    const red = units.units.find((u) => u.sku === 'TEE-RED')!;
    const navy = units.units.find((u) => u.sku === 'TEE-NAVY')!;
    expect(red.byStore[0].quantity).toBe(7);
    expect(navy.byStore[0].quantity).toBe(3);
    expect(units.hasStock).toBe(true);
  });

  it('refuses nonsense and unknown products', async () => {
    expect(await recordStockIn({ warehouseId: ids.store, lines: [] })).toEqual({
      success: false,
      error: expect.stringMatching(/at least one line/),
    });
    expect(await recordStockIn({ warehouseId: ids.store, lines: [{ inventoryItemId: ids.simple, quantity: 0 }] })).toMatchObject({
      success: false,
    });
    expect(await getProductStockUnits(ids.red)).toEqual({ success: false, error: 'Product not found' });
  });

  it('refuses without permission to record stock', async () => {
    const saved = ctx.membership.role.permissions;
    ctx.membership.role.permissions = [PERMISSIONS.INVENTORY_VIEW];
    try {
      expect(await recordStockIn({ warehouseId: ids.store, lines: [{ inventoryItemId: ids.simple, quantity: 1 }] })).toEqual({
        success: false,
        error: 'You do not have permission to do this',
      });
    } finally {
      ctx.membership.role.permissions = saved;
    }
  });
});
