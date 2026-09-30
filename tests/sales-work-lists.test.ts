/*
 * The one "to send" list and the one returns list (ROADMAP 12.4), and the
 * invoices list's Overdue view — against the real database with a mocked org
 * context and two throwaway workspaces, so another store's records are proven
 * to be a miss.
 *
 * Online-order parcels share the rule `sendShipment` uses and are exercised
 * end to end in storefront-order-lifecycle.test.ts; here the invoice side is
 * seeded directly, which is enough to prove the merge, the source filter, the
 * open/done split and the tenancy.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Work lists', slug: '', logoUrl: null, status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', warehouseIds: [] as string[], role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));
vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { listToSend, listAllReturns } = await import('@/features/sales/work-lists');
const { listInvoices } = await import('@/features/sales/actions');

vi.setConfig({ testTimeout: 60_000 });

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const orgIds: string[] = [];
const DAY = 86_400_000;

async function workspace(name: string) {
  const org = await prisma.organization.create({ data: { name, slug: `__test-worklists-${name}-${suffix}`.toLowerCase() } });
  orgIds.push(org.id);
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, name: `${name} shop` } });
  const customer = await prisma.customer.create({ data: { organizationId: org.id, name: `${name} customer` } });
  let n = 0;
  const invoice = (status: 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID', dueInDays: number | null) =>
    prisma.invoice.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        warehouseId: warehouse.id,
        invoiceNumber: `INV-${name}-${++n}`,
        status,
        subtotal: 1000,
        totalAmount: 1000,
        dueDate: dueInDays === null ? null : new Date(Date.now() + dueInDays * DAY),
      },
    });
  return { org, warehouse, invoice };
}

beforeAll(async () => {
  const mine = await workspace('Mine');
  const theirs = await workspace('Theirs');
  ctx.organization.id = mine.org.id;
  ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW];

  const late = await mine.invoice('SENT', -3);
  const partLate = await mine.invoice('PARTIALLY_PAID', -1);
  const notDue = await mine.invoice('SENT', 5);
  const paidLate = await mine.invoice('PAID', -10);
  await mine.invoice('DRAFT', -10);
  await mine.invoice('SENT', null);

  await prisma.fulfillment.create({ data: { organizationId: mine.org.id, invoiceId: late.id, warehouseId: mine.warehouse.id, status: 'PICKED' } });
  await prisma.fulfillment.create({
    data: { organizationId: mine.org.id, invoiceId: paidLate.id, warehouseId: mine.warehouse.id, status: 'SHIPPED', shippedAt: new Date() },
  });
  await prisma.fulfillment.create({ data: { organizationId: mine.org.id, invoiceId: notDue.id, warehouseId: mine.warehouse.id, status: 'CANCELLED' } });
  await prisma.returnRequest.create({ data: { organizationId: mine.org.id, invoiceId: partLate.id, status: 'REQUESTED', reason: 'DAMAGED' } });
  await prisma.returnRequest.create({ data: { organizationId: mine.org.id, invoiceId: paidLate.id, status: 'APPROVED' } });

  // Another store's work, which must never appear.
  const other = await theirs.invoice('SENT', -3);
  await prisma.fulfillment.create({ data: { organizationId: theirs.org.id, invoiceId: other.id, warehouseId: theirs.warehouse.id } });
  await prisma.returnRequest.create({ data: { organizationId: theirs.org.id, invoiceId: other.id } });
});

afterAll(async () => {
  for (const organizationId of orgIds) {
    await prisma.returnRequest.deleteMany({ where: { organizationId } });
    await prisma.fulfillment.deleteMany({ where: { organizationId } });
    await prisma.invoice.deleteMany({ where: { organizationId } });
    await prisma.customer.deleteMany({ where: { organizationId } });
    await prisma.warehouse.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

describe('to send', () => {
  it('lists open invoice fulfilments, marked by source, with a link to each', async () => {
    const result = await listToSend({});
    if (!result.success) throw new Error(result.error);
    expect(result.data.rows.map((r) => r.reference)).toEqual(['INV-Mine-1']);
    expect(result.data.rows[0]).toMatchObject({ source: 'invoice', statusLabel: expect.any(String) });
    expect(result.data.rows[0].href).toMatch(/^\/sales\/fulfillment\//);
    expect(result.data.counts).toEqual({ open: 1, openOrders: 0, openInvoices: 1 });
  });

  it('keeps sent ones in Sent, drops cancelled ones from All, and honours the source filter', async () => {
    const done = await listToSend({ filter: 'done' });
    expect(done.success && done.data.rows.map((r) => r.reference)).toEqual(['INV-Mine-4']);
    const all = await listToSend({ filter: 'all' });
    expect(all.success && all.data.rows.map((r) => r.reference).sort()).toEqual(['INV-Mine-1', 'INV-Mine-4']);
    const ordersOnly = await listToSend({ filter: 'all', source: 'order' });
    expect(ordersOnly.success && ordersOnly.data.rows).toEqual([]);
  });

  it('searches by invoice number or customer', async () => {
    const hit = await listToSend({ filter: 'all', q: 'mine customer' });
    expect(hit.success && hit.data.total).toBe(2);
    const miss = await listToSend({ filter: 'all', q: 'INV-Theirs' });
    expect(miss.success && miss.data.total).toBe(0);
  });
});

describe('returns', () => {
  it('shows what is waiting on you, then everything', async () => {
    const open = await listAllReturns({});
    if (!open.success) throw new Error(open.error);
    expect(open.data.rows.map((r) => r.reference)).toEqual(['INV-Mine-2']);
    expect(open.data.rows[0].source).toBe('invoice');
    expect(open.data.counts.open).toBe(1);
    const all = await listAllReturns({ filter: 'all' });
    expect(all.success && all.data.rows.map((r) => r.reference).sort()).toEqual(['INV-Mine-2', 'INV-Mine-4']);
    const ordersOnly = await listAllReturns({ filter: 'all', source: 'order' });
    expect(ordersOnly.success && ordersOnly.data.rows).toEqual([]);
  });
});

describe('invoices → Overdue', () => {
  it('is sent or part-paid with a due date already past — nothing else', async () => {
    const result = await listInvoices({ overdue: true });
    if (!result.success) throw new Error(result.error);
    expect(result.data.map((i) => i.invoiceNumber).sort()).toEqual(['INV-Mine-1', 'INV-Mine-2']);
    expect(result.data.every((i) => i.isOverdue)).toBe(true);
    const all = await listInvoices();
    expect(all.success && all.data.filter((i) => i.isOverdue).length).toBe(2);
  });
});
