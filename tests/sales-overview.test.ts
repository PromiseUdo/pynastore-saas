/*
 * The Sales landing page's four figures, which now come from the database
 * instead of from every quote, invoice and customer loaded into memory.
 *
 * What is worth pinning: "unpaid" is what was invoiced minus what has been
 * paid on invoices that are still owed, "overdue" is the same rule the invoice
 * list uses, and a merged customer is counted once — not twice.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Sales Overview Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] }, warehouseIds: [] as string[] },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { getSalesOverview } = await import('@/features/sales/overview');

const DAY = 86_400_000;

beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({ data: { name: 'Sales Overview Test', slug: `__test-salesov-${stamp}` } });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW];

  const customer = await prisma.customer.create({ data: { organizationId: org.id, name: 'Ada Obi' } });
  const survivor = await prisma.customer.create({ data: { organizationId: org.id, name: 'Chidi Eze' } });
  // A duplicate that was merged away keeps its row and must not be counted.
  await prisma.customer.create({ data: { organizationId: org.id, name: 'C. Eze', mergedIntoId: survivor.id } });

  const quote = (status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'EXPIRED', number: string) =>
    prisma.quote.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        quoteNumber: number,
        status,
        subtotal: 1000,
        totalAmount: 1000,
      },
    });
  await quote('DRAFT', 'QT-1');
  await quote('SENT', 'QT-2');
  await quote('ACCEPTED', 'QT-3'); // decided, so not open
  await quote('EXPIRED', 'QT-4');

  const invoice = (opts: {
    number: string;
    status: 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
    total: number;
    paid?: number;
    dueInDays?: number | null;
  }) =>
    prisma.invoice.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        invoiceNumber: opts.number,
        status: opts.status,
        subtotal: opts.total,
        totalAmount: opts.total,
        paidAmount: opts.paid ?? 0,
        dueDate: opts.dueInDays === null || opts.dueInDays === undefined ? null : new Date(Date.now() + opts.dueInDays * DAY),
      },
    });

  await invoice({ number: 'INV-1', status: 'SENT', total: 50_000, dueInDays: 7 }); // owed, not yet due
  await invoice({ number: 'INV-2', status: 'PARTIALLY_PAID', total: 30_000, paid: 10_000, dueInDays: -3 }); // owed and late
  await invoice({ number: 'INV-3', status: 'SENT', total: 5_000, dueInDays: -1 }); // owed and late
  await invoice({ number: 'INV-4', status: 'PAID', total: 90_000, paid: 90_000, dueInDays: -30 }); // settled
  await invoice({ number: 'INV-5', status: 'DRAFT', total: 70_000, dueInDays: -30 }); // never issued
  await invoice({ number: 'INV-6', status: 'SENT', total: 8_000, dueInDays: null }); // owed, no due date to miss
});

afterAll(async () => {
  const organizationId = ctx.organization.id;
  await prisma.invoice.deleteMany({ where: { organizationId } });
  await prisma.quote.deleteMany({ where: { organizationId } });
  await prisma.customer.updateMany({ where: { organizationId }, data: { mergedIntoId: null } });
  await prisma.customer.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
});

describe('getSalesOverview', () => {
  it('counts what is still open, still owed, and actually late', async () => {
    const result = await getSalesOverview();
    if (!result.success) throw new Error(result.error);

    expect(result.data.openQuotes).toBe(2); // the draft and the sent one
    // 50,000 + (30,000 − 10,000) + 5,000 + 8,000 — a paid or draft invoice is owed nothing.
    expect(result.data.unpaidTotal).toBe(83_000);
    // Late means issued or part paid AND past a due date it actually has.
    expect(result.data.overdueInvoices).toBe(2);
    expect(result.data.customers).toBe(2); // the merged duplicate is not a third person
  });

  it('needs permission to see sales', async () => {
    const granted = ctx.membership.role.permissions;
    ctx.membership.role.permissions = [];
    const result = await getSalesOverview();
    ctx.membership.role.permissions = granted;
    expect(result.success).toBe(false);
  });
});
