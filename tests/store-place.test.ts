/*
 * Where a store is, against the real database (ROADMAP Phase 9.1).
 *
 * The pure rule lives in features/inventory/store-place.test.ts. These cases
 * check the doors: that a store can't start selling online without a place,
 * can't lose its place while it sells online, and that a store which sold
 * online before places existed keeps working and can still be edited.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';
import { STORE_PLACE_REQUIRED_MESSAGE } from '@/features/inventory/store-place';
import { dropBilling, givePlan } from './helpers/plans';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Store Place Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE', currency: 'NGN' },
  membership: {
    id: 'm',
    role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] },
    warehouseIds: [] as string[],
  },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { createWarehouse, updateWarehouse, setWarehouseSellsOnline, listWarehouses } = await import(
  '@/features/inventory/warehouses'
);
const { getStoreDetail } = await import('@/features/inventory/store-detail');

const read = (id: string) =>
  prisma.warehouse.findUniqueOrThrow({ where: { id }, select: { state: true, city: true, location: true, sellsOnline: true } });

beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({ data: { name: 'Store Place Test', slug: `__test-storeplace-${stamp}` } });
  await givePlan(org.id);
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_EDIT, PERMISSIONS.INVENTORY_CREATE];
});

afterAll(async () => {
  const organizationId = ctx.organization.id;
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.warehouse.deleteMany({ where: { organizationId } });
  await dropBilling(organizationId);
  await prisma.organization.delete({ where: { id: organizationId } });
});

describe('creating a store', () => {
  it('keeps the state as listed and the city as typed, tidied', async () => {
    const created = await createWarehouse({ name: 'PH', state: 'Rivers', city: '  Port   Harcourt ' });
    if (!created.success) throw new Error(created.error);
    expect(await read(created.data.id)).toMatchObject({ state: 'Rivers', city: 'Port Harcourt' });

    const listed = await listWarehouses();
    if (!listed.success) throw new Error(listed.error);
    expect(listed.data.find((w) => w.id === created.data.id)).toMatchObject({ state: 'Rivers', city: 'Port Harcourt' });

    const detail = await getStoreDetail(created.data.id);
    if (!detail.success) throw new Error(detail.error);
    expect(detail.data).toMatchObject({ state: 'Rivers', city: 'Port Harcourt' });
  });

  it('may have no place at all — not every store sells online', async () => {
    const created = await createWarehouse({ name: 'Back room' });
    if (!created.success) throw new Error(created.error);
    expect(await read(created.data.id)).toMatchObject({ state: null, city: null });
  });

  it('refuses half a place, or a state that is not on the list', async () => {
    expect((await createWarehouse({ name: 'X', state: 'Rivers' })).success).toBe(false);
    expect((await createWarehouse({ name: 'X', city: 'Ikeja' })).success).toBe(false);
    expect((await createWarehouse({ name: 'X', state: 'Rivers State', city: 'Port Harcourt' })).success).toBe(false);
    expect(await prisma.warehouse.count({ where: { organizationId: ctx.organization.id, name: 'X' } })).toBe(0);
  });
});

describe('selling online needs a place', () => {
  it('refuses to switch on for a store with no place, and says why', async () => {
    const created = await createWarehouse({ name: 'Nowhere yet' });
    if (!created.success) throw new Error(created.error);

    const refused = await setWarehouseSellsOnline(created.data.id, true);
    expect(refused).toEqual({ success: false, error: STORE_PLACE_REQUIRED_MESSAGE });
    expect((await read(created.data.id)).sellsOnline).toBe(false);

    // Give it a place, and the same switch works.
    expect((await updateWarehouse(created.data.id, { name: 'Nowhere yet', state: 'Lagos', city: 'Ikeja' })).success).toBe(true);
    expect((await setWarehouseSellsOnline(created.data.id, true)).success).toBe(true);
    expect((await read(created.data.id)).sellsOnline).toBe(true);
  });

  it('will not let an online store lose its place', async () => {
    const created = await createWarehouse({ name: 'Lagos', state: 'Lagos', city: 'Lekki' });
    if (!created.success) throw new Error(created.error);
    await setWarehouseSellsOnline(created.data.id, true);

    expect((await updateWarehouse(created.data.id, { name: 'Lagos' })).success).toBe(false);
    expect((await updateWarehouse(created.data.id, { name: 'Lagos', state: 'Lagos', city: '' })).success).toBe(false);
    expect(await read(created.data.id)).toMatchObject({ state: 'Lagos', city: 'Lekki' });

    // Moving it is fine; turning it off online and then clearing is fine too.
    expect((await updateWarehouse(created.data.id, { name: 'Lagos', state: 'Lagos', city: 'Ikeja' })).success).toBe(true);
    await setWarehouseSellsOnline(created.data.id, false);
    expect((await updateWarehouse(created.data.id, { name: 'Lagos' })).success).toBe(true);
    expect(await read(created.data.id)).toMatchObject({ state: null, city: null });
  });

  it('keeps a store that sold online before places existed, and still lets it be edited', async () => {
    // As the migration leaves one: selling online, no place.
    const legacy = await prisma.warehouse.create({
      data: { organizationId: ctx.organization.id, name: 'Old shop', sellsOnline: true, location: 'Old Road' },
    });

    expect((await updateWarehouse(legacy.id, { name: 'Old shop renamed' })).success).toBe(true);
    expect(await read(legacy.id)).toMatchObject({ sellsOnline: true, state: null, city: null });

    // Switching it off and back on is where the new rule catches it.
    await setWarehouseSellsOnline(legacy.id, false);
    expect((await setWarehouseSellsOnline(legacy.id, true)).success).toBe(false);
  });
});

it('clearing the street address really clears it', async () => {
  const created = await createWarehouse({ name: 'Addr', location: '14 Awolowo Road' });
  if (!created.success) throw new Error(created.error);
  expect((await updateWarehouse(created.data.id, { name: 'Addr' })).success).toBe(true);
  expect((await read(created.data.id)).location).toBeNull();
});
