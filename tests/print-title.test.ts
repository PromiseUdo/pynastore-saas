/*
 * A printable page's title — the saved PDF's file name — names the shop and
 * the record, never the platform, and never another shop's record.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'AurafumeNG', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));
vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { printableTitle } = await import('@/lib/print-title');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const shop = { id: '', slug: `__test-print-title-${suffix}` };
const other = { id: '', slug: `__test-print-title-other-${suffix}` };
let orderId = '';
let theirOrderId = '';

beforeAll(async () => {
  shop.id = (await prisma.organization.create({ data: { name: 'AurafumeNG', slug: shop.slug } })).id;
  other.id = (await prisma.organization.create({ data: { name: 'Other', slug: other.slug } })).id;
  ctx.organization.id = shop.id;
  const order = (organizationId: string, reference: string) =>
    prisma.order.create({ data: { organizationId, reference, paymentMethod: 'pod', subtotal: 1, totalAmount: 1 } });
  orderId = (await order(shop.id, `ORD-${suffix}`)).id;
  theirOrderId = (await order(other.id, `THEIRS-${suffix}`)).id;
});

afterAll(async () => {
  for (const org of [shop, other]) {
    await prisma.order.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

describe('printableTitle', () => {
  it('names the shop, the document and its number — and skips the platform’s template', async () => {
    expect(await printableTitle({ kind: 'receipt', orderId })).toEqual({ title: { absolute: `AurafumeNG receipt ORD-${suffix}` } });
    expect(await printableTitle({ kind: 'packing slip', orderId })).toEqual({
      title: { absolute: `AurafumeNG packing slip ORD-${suffix}` },
    });
  });

  it('never shows another shop’s record number', async () => {
    expect(await printableTitle({ kind: 'receipt', orderId: theirOrderId })).toEqual({ title: { absolute: 'AurafumeNG receipt' } });
  });
});
