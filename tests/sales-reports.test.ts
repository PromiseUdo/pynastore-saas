/*
 * The reports hub (ROADMAP 14.6).
 *
 * These cases pin the definitions the screens state: an order counts on the
 * Lagos day it was placed, at its total, whatever the channel; cancelled
 * orders count for nothing; refunds are beside the sales, not taken off;
 * products are their lines; a customer is "new" when their first order ever
 * is in the period; a campaign counts only the part of its window inside the
 * period; and nothing from another workspace ever appears.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';
import { lagosDay } from '@/lib/reports/period';
import { dropBilling, givePlan } from './helpers/plans';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Reports Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { getRevenueReport, getTopProductsReport, getTopCustomersReport, getDiscountsReport } = await import(
  '@/features/reports/sales-reports'
);

const DAY = 86_400_000;
/** A Lagos day, `offset` days from today, as YYYY-MM-DD. */
const day = (offset: number) => lagosDay(new Date(Date.now() + offset * DAY));
/** A moment on a Lagos day: `hhmm` Lagos time (UTC+1). */
const at = (offset: number, hh: number, mm = 0) =>
  new Date(Date.parse(`${day(offset)}T00:00:00Z`) - 3_600_000 + (hh * 60 + mm) * 60_000);

/** The period every case reads: 11 days, ten days ago back to twenty. */
const PERIOD = { from: day(-20), to: day(-10) };

let otherOrgId = '';
let shirt = '';
let mug = '';
let ada = '';
let bola = '';
let campaignId = '';
let codeId = '';

async function order(input: {
  reference: string;
  channel: 'ONLINE' | 'WALK_IN' | 'PHONE';
  placedAt: Date;
  status?: 'CONFIRMED' | 'CANCELLED';
  paymentStatus?: 'PAID' | 'DUE_ON_DELIVERY';
  customerId?: string | null;
  deliveryFee?: number;
  discount?: number;
  discountCodeId?: string;
  discountCode?: string;
  organizationId?: string;
  lines: { productId: string | null; name: string; quantity: number; unitPrice: number }[];
}) {
  const subtotal = input.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const created = await prisma.order.create({
    data: {
      organizationId: input.organizationId ?? ctx.organization.id,
      reference: input.reference,
      channel: input.channel,
      status: input.status ?? 'CONFIRMED',
      paymentStatus: input.paymentStatus ?? 'PAID',
      paymentMethod: input.channel === 'ONLINE' ? 'card' : 'cash',
      customerId: input.customerId ?? null,
      placedAt: input.placedAt,
      subtotal,
      discount: input.discount ?? 0,
      discountCodeId: input.discountCodeId,
      discountCode: input.discountCode,
      deliveryFee: input.deliveryFee ?? null,
      totalAmount: subtotal - (input.discount ?? 0) + (input.deliveryFee ?? 0),
      lineItems: {
        create: input.lines.map((line) => ({
          productId: line.productId,
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          totalPrice: line.unitPrice * line.quantity,
        })),
      },
    },
  });
  return created.id;
}

beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({ data: { name: 'Reports Test', slug: `__test-reports-${stamp}` } });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW, PERMISSIONS.CUSTOMER_VIEW];
  await givePlan(org.id, 'pro');

  const other = await prisma.organization.create({ data: { name: 'Other', slug: `__test-reports-other-${stamp}` } });
  otherOrgId = other.id;

  shirt = (await prisma.inventoryItem.create({ data: { organizationId: org.id, sku: 'SHIRT', name: 'Linen shirt' } })).id;
  mug = (await prisma.inventoryItem.create({ data: { organizationId: org.id, sku: 'MUG', name: 'Enamel mug' } })).id;
  ada = (await prisma.customer.create({ data: { organizationId: org.id, name: 'Ada Obi', email: 'ada@example.com' } })).id;
  bola = (await prisma.customer.create({ data: { organizationId: org.id, name: 'Bola Ade' } })).id;

  // A campaign on the shirt (5,000 → 4,500) that ends three days before the period does.
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: org.id,
      name: 'Harmattan sale',
      status: 'SCHEDULED',
      mechanic: 'PERCENT_OFF',
      value: 10,
      startsAt: at(-30, 0),
      endsAt: at(-13, 0),
      targetKind: 'PRODUCT',
      targetIds: [shirt],
      prices: { create: { organizationId: org.id, inventoryItemId: shirt, originalPrice: 5000, price: 4500 } },
    },
  });
  campaignId = campaign.id;
  // A draft never ran, so it reports nothing.
  await prisma.campaign.create({
    data: {
      organizationId: org.id,
      name: 'Not yet',
      status: 'DRAFT',
      mechanic: 'PERCENT_OFF',
      value: 50,
      startsAt: at(-20, 0),
      targetKind: 'STORE',
    },
  });
  codeId = (
    await prisma.discountCode.create({
      data: { organizationId: org.id, code: 'SAVE500', label: '₦500 off', kind: 'FIXED', value: 500, campaignId },
    })
  ).id;

  // 00:30 in Lagos is still the day before in UTC: it must count on its Lagos day.
  await order({
    reference: 'ORD-A',
    channel: 'ONLINE',
    placedAt: at(-15, 0, 30),
    customerId: ada,
    deliveryFee: 1500,
    discount: 500,
    discountCodeId: codeId,
    discountCode: 'SAVE500',
    lines: [{ productId: shirt, name: 'Linen shirt', quantity: 2, unitPrice: 4500 }],
  }); // total 10,000
  await order({
    reference: 'ORD-B',
    channel: 'WALK_IN',
    placedAt: at(-15, 12),
    discount: 1000,
    lines: [{ productId: mug, name: 'Enamel mug', quantity: 1, unitPrice: 5000 }],
  }); // total 4,000, nobody's name, a counter discount
  await order({
    reference: 'ORD-C',
    channel: 'ONLINE',
    placedAt: at(-12, 9),
    customerId: ada,
    paymentStatus: 'DUE_ON_DELIVERY',
    lines: [{ productId: shirt, name: 'Linen shirt', quantity: 1, unitPrice: 6000 }],
  }); // total 6,000, after the campaign ended, not paid yet
  await order({
    reference: 'ORD-D',
    channel: 'ONLINE',
    placedAt: at(-12, 10),
    status: 'CANCELLED',
    customerId: bola,
    lines: [{ productId: shirt, name: 'Linen shirt', quantity: 10, unitPrice: 9900 }],
  }); // cancelled: counts for nothing
  await order({
    reference: 'ORD-E',
    channel: 'PHONE',
    placedAt: at(-11, 15),
    customerId: bola,
    lines: [{ productId: null, name: 'Old scarf', quantity: 1, unitPrice: 2000 }],
  }); // a product since deleted
  await order({
    reference: 'ORD-F',
    channel: 'ONLINE',
    placedAt: at(-25, 12),
    customerId: bola,
    lines: [{ productId: shirt, name: 'Linen shirt', quantity: 1, unitPrice: 4500 }],
  }); // before the period: the comparison, and Bola's first order
  await order({
    reference: 'ORD-X',
    channel: 'ONLINE',
    placedAt: at(-15, 12),
    organizationId: other.id,
    lines: [{ productId: null, name: 'Their thing', quantity: 1, unitPrice: 77_000 }],
  });

  const placed = await prisma.order.findFirstOrThrow({ where: { organizationId: org.id, reference: 'ORD-A' } });
  await prisma.orderRefund.create({
    data: { organizationId: org.id, orderId: placed.id, amount: 1000, createdAt: at(-14, 10) },
  });
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.orderRefund.deleteMany({ where: { organizationId } });
    await prisma.orderLineItem.deleteMany({ where: { order: { organizationId } } });
    await prisma.order.deleteMany({ where: { organizationId } });
    await prisma.discountCode.deleteMany({ where: { organizationId } });
    await prisma.campaign.deleteMany({ where: { organizationId } });
    await prisma.customer.deleteMany({ where: { organizationId } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId } });
    await dropBilling(organizationId);
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

describe('sales by day and channel', () => {
  it('counts every channel at the order total, on its Lagos day, without cancelled orders', async () => {
    const result = await getRevenueReport(PERIOD);
    if (!result.success) throw new Error(result.error);
    const { totals, buckets } = result.data;

    expect(result.data.unit).toBe('day');
    expect(buckets).toHaveLength(11);
    expect(totals.sales).toBe(22_000);
    expect(totals.orders).toBe(4);
    expect(totals.averageOrder).toBe(5_500);
    expect(totals.byChannel).toEqual({ online: 16_000, inStore: 4_000, phone: 2_000 });
    expect(totals.ordersByChannel).toEqual({ online: 2, inStore: 1, phone: 1 });

    const first = buckets.find((b) => b.key === day(-15))!;
    expect(first).toMatchObject({ sales: 14_000, orders: 2, online: 10_000, inStore: 4_000 });
    expect(buckets.find((b) => b.key === day(-16))!.sales).toBe(0);
  });

  it('shows what is unpaid, refunded, discounted and delivery beside the sales', async () => {
    const result = await getRevenueReport(PERIOD);
    if (!result.success) throw new Error(result.error);
    expect(result.data.totals).toMatchObject({ unpaid: 6_000, refunds: 1_000, discounts: 1_500, delivery: 1_500, vat: 0 });
  });

  it('compares with the same number of days just before', async () => {
    const result = await getRevenueReport(PERIOD);
    if (!result.success) throw new Error(result.error);
    expect(result.data.previous).toEqual({ sales: 4_500, orders: 1 });
  });

  it('groups a long period by month', async () => {
    const result = await getRevenueReport({ range: '12m' });
    if (!result.success) throw new Error(result.error);
    expect(result.data.unit).toBe('month');
    expect(result.data.buckets.length).toBeGreaterThanOrEqual(12);
    expect(result.data.totals.sales).toBe(26_500);
  });
});

describe('top products', () => {
  it('ranks products by what their lines sold for, keeping a deleted one by name', async () => {
    const result = await getTopProductsReport(PERIOD);
    if (!result.success) throw new Error(result.error);
    const { rows, totals, productCount } = result.data;

    expect(rows.map((r) => r.name)).toEqual(['Linen shirt', 'Enamel mug', 'Old scarf']);
    expect(rows[0]).toMatchObject({ productId: shirt, sku: 'SHIRT', unitsSold: 3, revenue: 15_000, onlineRevenue: 15_000, orders: 2 });
    // The counter discount belongs to the order, so the mug keeps its line price.
    expect(rows[1]).toMatchObject({ productId: mug, revenue: 5_000, onlineRevenue: 0 });
    expect(rows[2]).toMatchObject({ productId: null, revenue: 2_000 });
    expect(productCount).toBe(3);
    expect(totals).toEqual({ revenue: 22_000, unitsSold: 5 });
    expect(rows[0].shareRatio).toBeCloseTo(15 / 22);
  });
});

describe('top customers', () => {
  it('ranks by spend, tells new from returning, and counts nameless sales apart', async () => {
    const result = await getTopCustomersReport(PERIOD);
    if (!result.success) throw new Error(result.error);
    const report = result.data;

    expect(report.rows.map((r) => [r.name, r.orders, r.spend, r.isNew])).toEqual([
      ['Ada Obi', 2, 16_000, true],
      ['Bola Ade', 1, 2_000, false],
    ]);
    expect(report.customerCount).toBe(2);
    expect(report.newCustomers).toBe(1);
    expect(report.repeatCustomers).toBe(1);
    expect(report.anonymous).toEqual({ orders: 1, spend: 4_000 });
  });

  it('needs permission to see customers', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW];
    try {
      const result = await getTopCustomersReport(PERIOD);
      expect(result.success).toBe(false);
    } finally {
      ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW, PERMISSIONS.CUSTOMER_VIEW];
    }
  });
});

describe('discounts and campaigns', () => {
  it('reports codes, counter discounts, and only the part of a campaign inside the period', async () => {
    const result = await getDiscountsReport(PERIOD);
    if (!result.success) throw new Error(result.error);
    const report = result.data;

    expect(report.codes).toEqual([
      {
        discountCodeId: codeId,
        code: 'SAVE500',
        label: null,
        campaignName: 'Harmattan sale',
        orders: 1,
        discountGiven: 500,
        sales: 10_000,
      },
    ]);
    expect(report.counter).toEqual({ orders: 1, discountGiven: 1_000 });

    // Order A only: F was before the period, C after the campaign ended.
    expect(report.campaigns).toHaveLength(1);
    expect(report.campaigns[0]).toMatchObject({
      campaignId,
      name: 'Harmattan sale',
      offer: '10% off',
      isRunning: false,
      orders: 1,
      unitsSold: 2,
      revenue: 9_000,
      discountGiven: 1_000,
      codeRedemptions: 1,
    });
    expect(report.totals).toEqual({ orderDiscounts: 1_500, campaignDiscounts: 1_000, ordersWithCode: 1 });
  });

  it('is part of Advanced reports', async () => {
    await givePlan(ctx.organization.id, 'starter');
    try {
      const result = await getDiscountsReport(PERIOD);
      expect(result.success).toBe(false);
    } finally {
      await givePlan(ctx.organization.id, 'pro');
    }
  });
});

describe('tenancy', () => {
  it('never counts another workspace’s orders', async () => {
    const result = await getRevenueReport(PERIOD);
    if (!result.success) throw new Error(result.error);
    expect(result.data.totals.sales).not.toBe(22_000 + 77_000);
    const products = await getTopProductsReport(PERIOD);
    if (!products.success) throw new Error(products.error);
    expect(products.data.rows.map((r) => r.name)).not.toContain('Their thing');
  });
});
