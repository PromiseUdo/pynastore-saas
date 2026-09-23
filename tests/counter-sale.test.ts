/*
 * A sale rung up at the counter, against the real database.
 *
 * The guarantees that matter:
 *   - it is an Order, in the same table and the same reference run as the
 *     storefront's, so "what did we sell today" is one query;
 *   - the stock leaves the store it was sold from — reserved and dispatched
 *     in one go, with an OUT movement, because the goods are already in the
 *     customer's hands;
 *   - it takes stock only from the store chosen, even when that store does
 *     not sell online;
 *   - it cannot oversell, and a refused sale leaves no order and no stock
 *     moved behind it;
 *   - prices come from the catalogue unless staff deliberately override one;
 *   - it never appears on the storefront: not in a shopper's order list, not
 *     through track-order, not on a confirmation page.
 *
 * Email is stubbed at lib/email.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/email', () => ({
  sendStorefrontOrderUpdateEmail: vi.fn(async () => {}),
  sendStoreOrderAlertEmail: vi.fn(async () => {}),
  sendLowStockAlertEmail: vi.fn(async () => {}),
}));

const ctx = vi.hoisted(() => ({
  organization: {
    id: '',
    name: 'Counter Test',
    slug: '',
    logoUrl: null,
    plan: 'PRO',
    status: 'ACTIVE',
    currency: 'NGN',
  },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  /* AuditLog.userId and Order.soldByUserId are real foreign keys and this
   * fixture has no User row, so nobody is attributed. */
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';
import { findOrderByReferenceAndEmail, listOrdersForCustomer } from '@/lib/storefront/orders/read';

const { recordCounterSale, searchSellableProducts, searchCustomers, listCounterStores } = await import(
  '@/features/sales/counter-sale'
);

/* Neon is slow from here — seconds a step, not milliseconds. */
vi.setConfig({ testTimeout: 90_000 });

let shopFloorId = '';
let backRoomId = '';
let otherOrgId = '';
let otherStoreId = '';

/** A product with `quantity` on the shelf in `warehouseId`. */
async function product(name: string, quantity: number, warehouseId = shopFloorId, price = 1000) {
  const item = await prisma.inventoryItem.create({
    data: {
      organizationId: ctx.organization.id,
      sku: `${name}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      sellingPrice: price,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  await prisma.inventoryLevel.create({
    data: { inventoryItemId: item.id, warehouseId, quantity },
  });
  return item.id;
}

async function shelf(inventoryItemId: string, warehouseId = shopFloorId) {
  const level = await prisma.inventoryLevel.findUniqueOrThrow({
    where: { inventoryItemId_warehouseId: { inventoryItemId, warehouseId } },
    select: { quantity: true, reservedQty: true },
  });
  return { quantity: Number(level.quantity), reserved: Number(level.reservedQty) };
}

beforeAll(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const org = await prisma.organization.create({
    data: { name: 'Counter Test', slug: `__test-counter-${suffix}` },
  });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;

  /* Deliberately NOT selling online: a shop counter sells what is on its own
   * shelves, which is the whole point of the warehouseId argument. */
  shopFloorId = (
    await prisma.warehouse.create({
      data: { organizationId: org.id, name: 'Shop floor', sellsOnline: false },
      select: { id: true },
    })
  ).id;
  backRoomId = (
    await prisma.warehouse.create({
      data: { organizationId: org.id, name: 'Back room', sellsOnline: false },
      select: { id: true },
    })
  ).id;

  otherOrgId = (
    await prisma.organization.create({ data: { name: 'Other', slug: `__test-counter-other-${suffix}` } })
  ).id;
  otherStoreId = (
    await prisma.warehouse.create({
      data: { organizationId: otherOrgId, name: 'Theirs' },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.orderStockAllocation.deleteMany({ where: { organizationId } });
    await prisma.orderLineItem.deleteMany({ where: { order: { organizationId } } });
    await prisma.order.deleteMany({ where: { organizationId } });
    await prisma.stockMovement.deleteMany({ where: { organizationId } });
    await prisma.inventoryLevel.deleteMany({ where: { inventoryItem: { organizationId } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId } });
    await prisma.warehouse.deleteMany({ where: { organizationId } });
    await prisma.customer.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

beforeEach(() => {
  ctx.membership.role.permissions = [PERMISSIONS.SALES_ORDER_CREATE, PERMISSIONS.SALES_VIEW];
});

function unwrap<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

describe('recordCounterSale', () => {
  it('writes an Order, takes the stock out, and leaves nothing held', async () => {
    const id = await product('Ankara Shirt', 10);

    const sale = unwrap(
      await recordCounterSale({
        warehouseId: shopFloorId,
        paymentMethod: 'cash',
        lines: [{ inventoryItemId: id, quantity: 3 }],
      }),
    );

    expect(sale.reference).toMatch(/^ORD-\d{4}-\d{6}$/);
    expect(sale.totalAmount).toBe(3000);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      select: {
        channel: true,
        status: true,
        paymentStatus: true,
        paidAt: true,
        warehouseId: true,
        confirmationToken: true,
        customerId: true,
        deliveryMethodId: true,
        shipLine1: true,
        email: true,
        subtotal: true,
        totalAmount: true,
      },
    });

    expect(order).toMatchObject({
      channel: 'WALK_IN',
      // Sold and handed over in one motion — there is no packing to wait for.
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      warehouseId: shopFloorId,
    });
    expect(order.paidAt).not.toBeNull();
    // Nothing a counter sale doesn't have is invented for it.
    expect(order.confirmationToken).toBeNull();
    expect(order.customerId).toBeNull();
    expect(order.deliveryMethodId).toBeNull();
    expect(order.shipLine1).toBeNull();
    expect(order.email).toBeNull();

    // The goods have gone: quantity down, nothing left reserved.
    expect(await shelf(id)).toEqual({ quantity: 7, reserved: 0 });

    const movements = await prisma.stockMovement.findMany({
      where: { referenceId: sale.orderId },
      select: { type: true, quantity: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(movements.map((m) => m.type)).toEqual(['RESERVED', 'OUT']);

    const allocations = await prisma.orderStockAllocation.findMany({
      where: { orderId: sale.orderId },
      select: { status: true, warehouseId: true },
    });
    expect(allocations).toEqual([{ status: 'DISPATCHED', warehouseId: shopFloorId }]);
  });

  it('takes stock only from the store it was sold in', async () => {
    const id = await product('Split Stock', 2);
    await prisma.inventoryLevel.create({
      data: { inventoryItemId: id, warehouseId: backRoomId, quantity: 50 },
    });

    /* The back room has plenty. Selling 3 on the shop floor must still fail:
     * the customer is standing in front of the shop floor's shelves. */
    const result = await recordCounterSale({
      warehouseId: shopFloorId,
      paymentMethod: 'cash',
      lines: [{ inventoryItemId: id, quantity: 3 }],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/Shop floor/);
    expect(await shelf(id)).toEqual({ quantity: 2, reserved: 0 });
    expect(await shelf(id, backRoomId)).toEqual({ quantity: 50, reserved: 0 });
  });

  it('leaves no order behind when it can’t be filled', async () => {
    const id = await product('Nearly Gone', 1);
    const before = await prisma.order.count({ where: { organizationId: ctx.organization.id } });

    const result = await recordCounterSale({
      warehouseId: shopFloorId,
      paymentMethod: 'cash',
      lines: [{ inventoryItemId: id, quantity: 5 }],
    });

    expect(result.success).toBe(false);
    expect(await prisma.order.count({ where: { organizationId: ctx.organization.id } })).toBe(before);
    expect(await shelf(id)).toEqual({ quantity: 1, reserved: 0 });
  });

  it('prices from the catalogue, and records a deliberate override as a lower total', async () => {
    const id = await product('Haggled Wrapper', 5, shopFloorId, 5000);

    const catalogue = unwrap(
      await recordCounterSale({
        warehouseId: shopFloorId,
        paymentMethod: 'cash',
        lines: [{ inventoryItemId: id, quantity: 1 }],
      }),
    );
    expect(catalogue.totalAmount).toBe(5000);

    const haggled = unwrap(
      await recordCounterSale({
        warehouseId: shopFloorId,
        paymentMethod: 'cash',
        lines: [{ inventoryItemId: id, quantity: 1, unitPrice: 4200 }],
      }),
    );
    expect(haggled.totalAmount).toBe(4200);
  });

  it('takes a whole-sale discount off the total, never below zero', async () => {
    const id = await product('Discounted', 5, shopFloorId, 1000);
    const sale = unwrap(
      await recordCounterSale({
        warehouseId: shopFloorId,
        paymentMethod: 'card',
        discount: 100_000,
        lines: [{ inventoryItemId: id, quantity: 2 }],
      }),
    );
    expect(sale.totalAmount).toBe(0);
  });

  it('records a "paying later" sale as unpaid, but the goods still leave', async () => {
    const id = await product('On Credit', 4);
    const sale = unwrap(
      await recordCounterSale({
        warehouseId: shopFloorId,
        paymentMethod: 'later',
        lines: [{ inventoryItemId: id, quantity: 2 }],
      }),
    );

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      select: { paymentStatus: true, paidAt: true, status: true },
    });
    expect(order).toMatchObject({ paymentStatus: 'AWAITING_PAYMENT', status: 'DELIVERED', paidAt: null });
    expect(await shelf(id)).toEqual({ quantity: 2, reserved: 0 });
  });

  it('refuses a member without sales.order.create', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW];
    const id = await product('Not Allowed', 3);
    const result = await recordCounterSale({
      warehouseId: shopFloorId,
      paymentMethod: 'cash',
      lines: [{ inventoryItemId: id, quantity: 1 }],
    });
    expect(result.success).toBe(false);
    expect(await shelf(id)).toEqual({ quantity: 3, reserved: 0 });
  });

  it('refuses a store belonging to another workspace', async () => {
    const id = await product('Tenancy', 3);
    const result = await recordCounterSale({
      warehouseId: otherStoreId,
      paymentMethod: 'cash',
      lines: [{ inventoryItemId: id, quantity: 1 }],
    });
    expect(result.success).toBe(false);
    expect(await shelf(id)).toEqual({ quantity: 3, reserved: 0 });
  });

  it('never shows up on the storefront', async () => {
    const id = await product('In Store Only', 5);
    const customer = await prisma.customer.create({
      data: { organizationId: ctx.organization.id, name: 'Ada Obi', email: `ada-${Date.now()}@example.com` },
      select: { id: true, email: true },
    });

    const sale = unwrap(
      await recordCounterSale({
        warehouseId: shopFloorId,
        paymentMethod: 'cash',
        customerId: customer.id,
        customerName: 'Ada Obi',
        lines: [{ inventoryItemId: id, quantity: 1 }],
      }),
    );

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      select: { customerId: true, reference: true },
    });
    expect(row.customerId).toBe(customer.id);

    /* Attached to a real customer, and STILL not part of their web account:
     * there is nothing to track, no delivery and no address to show. */
    const theirs = await listOrdersForCustomer({ organizationId: ctx.organization.id }, customer.id);
    expect(theirs.map((o) => o.reference)).not.toContain(row.reference);

    const tracked = await findOrderByReferenceAndEmail(
      { organizationId: ctx.organization.id },
      row.reference,
      customer.email!,
    );
    expect(tracked).toBeNull();
  });

  it('writes an audit entry naming the channel and the store', async () => {
    const id = await product('Audited', 3);
    const sale = unwrap(
      await recordCounterSale({
        warehouseId: shopFloorId,
        channel: 'PHONE',
        paymentMethod: 'transfer',
        lines: [{ inventoryItemId: id, quantity: 1 }],
      }),
    );

    const log = await prisma.auditLog.findFirst({
      where: { organizationId: ctx.organization.id, entityId: sale.orderId, action: 'sales.order.created' },
      select: { metadata: true },
    });
    expect(log?.metadata).toMatchObject({ channel: 'PHONE', store: 'Shop floor' });
  });
});

describe('the customer on a counter sale', () => {
  it('keeps a new customer, so their next visit is already here', async () => {
    const id = await product('First Visit', 5);

    const sale = unwrap(
      await recordCounterSale({
        warehouseId: shopFloorId,
        paymentMethod: 'cash',
        customerName: 'Chidi Okeke',
        customerPhone: '08011112222',
        lines: [{ inventoryItemId: id, quantity: 1 }],
      }),
    );

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      select: { customerId: true, isGuest: true, customer: { select: { name: true, phone: true } } },
    });

    expect(order.customerId).not.toBeNull();
    expect(order.isGuest).toBe(false);
    expect(order.customer).toMatchObject({ name: 'Chidi Okeke', phone: '08011112222' });

    /* The point of keeping it: Phase 4 counts orders through this link, and
     * the till can find them next time. */
    const found = unwrap(await searchCustomers('Chidi'));
    expect(found.map((c) => c.id)).toContain(order.customerId);
  });

  it('reuses the existing record when the same phone comes back', async () => {
    const id = await product('Repeat Visit', 5);

    const first = unwrap(
      await recordCounterSale({
        warehouseId: shopFloorId,
        paymentMethod: 'cash',
        customerName: 'Ngozi Eze',
        customerPhone: '08033334444',
        lines: [{ inventoryItemId: id, quantity: 1 }],
      }),
    );
    const second = unwrap(
      await recordCounterSale({
        warehouseId: shopFloorId,
        paymentMethod: 'cash',
        // Typed slightly differently the second time, same phone.
        customerName: 'Ngozi E',
        customerPhone: '08033334444',
        lines: [{ inventoryItemId: id, quantity: 1 }],
      }),
    );

    const ids = await prisma.order.findMany({
      where: { id: { in: [first.orderId, second.orderId] } },
      select: { customerId: true },
    });
    expect(new Set(ids.map((o) => o.customerId)).size).toBe(1);
  });

  it('does NOT merge two people who happen to share a name', async () => {
    const id = await product('Same Name', 5);

    const a = unwrap(
      await recordCounterSale({
        warehouseId: shopFloorId,
        paymentMethod: 'cash',
        customerName: 'Ada Obi',
        customerPhone: '08055556666',
        lines: [{ inventoryItemId: id, quantity: 1 }],
      }),
    );
    const b = unwrap(
      await recordCounterSale({
        warehouseId: shopFloorId,
        paymentMethod: 'cash',
        customerName: 'Ada Obi',
        customerPhone: '08077778888',
        lines: [{ inventoryItemId: id, quantity: 1 }],
      }),
    );

    const ids = await prisma.order.findMany({
      where: { id: { in: [a.orderId, b.orderId] } },
      select: { customerId: true },
    });
    expect(new Set(ids.map((o) => o.customerId)).size).toBe(2);
  });

  it('creates nobody for an anonymous cash sale', async () => {
    const id = await product('Anonymous', 5);
    const before = await prisma.customer.count({ where: { organizationId: ctx.organization.id } });

    const sale = unwrap(
      await recordCounterSale({
        warehouseId: shopFloorId,
        paymentMethod: 'cash',
        lines: [{ inventoryItemId: id, quantity: 1 }],
      }),
    );

    expect(await prisma.customer.count({ where: { organizationId: ctx.organization.id } })).toBe(before);
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      select: { customerId: true, isGuest: true },
    });
    expect(order).toMatchObject({ customerId: null, isGuest: true });
  });

  it('attaches an existing online shopper that staff picked from the search', async () => {
    const id = await product('Known Shopper', 5);
    const shopper = await prisma.customer.create({
      data: {
        organizationId: ctx.organization.id,
        name: 'Web Shopper',
        email: `web-${Date.now()}@example.com`,
      },
      select: { id: true },
    });

    const found = unwrap(await searchCustomers('Web Shopper'));
    expect(found.map((c) => c.id)).toContain(shopper.id);

    const sale = unwrap(
      await recordCounterSale({
        warehouseId: shopFloorId,
        paymentMethod: 'cash',
        customerId: shopper.id,
        lines: [{ inventoryItemId: id, quantity: 1 }],
      }),
    );

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      select: { customerId: true },
    });
    expect(order.customerId).toBe(shopper.id);
  });

  it('never reaches another workspace’s customers', async () => {
    await prisma.customer.create({
      data: { organizationId: otherOrgId, name: 'Someone Elses Customer' },
    });
    const found = unwrap(await searchCustomers('Someone Elses'));
    expect(found).toEqual([]);
  });
});

describe('searchSellableProducts', () => {
  it('finds by name and by SKU, and reports what this store actually holds', async () => {
    const id = await product('Searchable Gele', 6);
    const sku = (await prisma.inventoryItem.findUniqueOrThrow({ where: { id }, select: { sku: true } })).sku;

    const byName = unwrap(await searchSellableProducts(shopFloorId, 'Searchable'));
    expect(byName.find((p) => p.inventoryItemId === id)?.available).toBe(6);

    const bySku = unwrap(await searchSellableProducts(shopFloorId, sku));
    expect(bySku.map((p) => p.inventoryItemId)).toContain(id);

    /* Available is per store: the back room has never seen this product. */
    const elsewhere = unwrap(await searchSellableProducts(backRoomId, 'Searchable'));
    expect(elsewhere.find((p) => p.inventoryItemId === id)?.available).toBe(0);
  });

  it('refuses a store from another workspace', async () => {
    const result = await searchSellableProducts(otherStoreId, 'anything');
    expect(result.success).toBe(false);
  });
});

describe('listCounterStores', () => {
  it('lists this workspace’s stores, whether or not they sell online', async () => {
    const stores = unwrap(await listCounterStores());
    expect(stores.map((s) => s.name).sort()).toEqual(['Back room', 'Shop floor']);
  });
});
