/*
 * Sending an invoice to the customer, and their copy of it — against the
 * real database.
 *
 * The rules that matter:
 *   - the customer-facing page opens on the TOKEN and nothing else; the
 *     invoice number counts upwards, so accepting it would hand over the
 *     whole store's invoices;
 *   - a token is matched together with the store, so one merchant's token is
 *     a miss under another's domain;
 *   - a draft and a voided invoice answer exactly like a wrong token, so the
 *     page can't be used to find out which invoices exist;
 *   - an invoice with no customer email can't be sent, rather than failing
 *     silently somewhere in the mail layer;
 *   - "still to pay" is the total less what the merchant recorded receiving.
 *
 * Email is stubbed at lib/email, and the calls are inspected: an invoice
 * email that doesn't carry the merchant's own name is a bug.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({ invoices: [] as Record<string, unknown>[] }));
vi.mock('@/lib/email', () => ({
  sendInvoiceEmail: vi.fn(async (payload: Record<string, unknown>) => {
    sent.invoices.push(payload);
  }),
  sendLowStockAlertEmail: vi.fn(async () => {}),
  sendStorefrontOrderUpdateEmail: vi.fn(async () => {}),
  sendStoreOrderAlertEmail: vi.fn(async () => {}),
}));

const ctx = vi.hoisted(() => ({
  organization: {
    id: '',
    name: 'Adire Studio',
    slug: '',
    logoUrl: null,
    plan: 'PRO',
    status: 'ACTIVE',
    currency: 'NGN',
  },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';
import { getInvoiceByToken } from '@/lib/storefront/invoices/read';

const { sendInvoice, sendInvoiceReminder, getInvoice, recordPayment } = await import(
  '@/features/sales/invoices'
);

vi.setConfig({ testTimeout: 90_000 });

let warehouseId = '';
let customerId = '';
let namelessCustomerId = '';
let otherOrgId = '';
let counter = 0;

/** A DRAFT invoice for `total`, with one line. */
async function invoice(total: number, options: { customerId?: string; dueDate?: Date } = {}) {
  counter += 1;
  return prisma.invoice.create({
    data: {
      organizationId: ctx.organization.id,
      customerId: options.customerId ?? customerId,
      /* Every invoice created through the app has a fulfillment store
       * (CreateInvoiceSchema requires one), and issuing checks it. */
      warehouseId,
      invoiceNumber: `INV-TEST-${counter}`,
      status: 'DRAFT',
      currency: 'NGN',
      subtotal: total,
      totalAmount: total,
      dueDate: options.dueDate,
      lineItems: {
        create: [{ description: 'Ankara fabric', quantity: 2, unitPrice: total / 2, totalPrice: total }],
      },
    },
    select: { id: true, invoiceNumber: true },
  });
}

beforeAll(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const org = await prisma.organization.create({
    data: { name: 'Adire Studio', slug: `__test-invoice-${suffix}` },
  });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;

  warehouseId = (
    await prisma.warehouse.create({
      data: { organizationId: org.id, name: 'Main store' },
      select: { id: true },
    })
  ).id;

  customerId = (
    await prisma.customer.create({
      data: { organizationId: org.id, name: 'Ada Obi', email: `ada-${suffix}@example.com` },
      select: { id: true },
    })
  ).id;

  namelessCustomerId = (
    await prisma.customer.create({
      data: { organizationId: org.id, name: 'No Email Ltd' },
      select: { id: true },
    })
  ).id;

  otherOrgId = (
    await prisma.organization.create({ data: { name: 'Other', slug: `__test-invoice-other-${suffix}` } })
  ).id;
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.payment.deleteMany({ where: { organizationId } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { organizationId } } });
    await prisma.invoice.deleteMany({ where: { organizationId } });
    await prisma.merchantBankAccount.deleteMany({ where: { organizationId } });
    await prisma.customer.deleteMany({ where: { organizationId } });
    await prisma.warehouse.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

beforeEach(() => {
  ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW, PERMISSIONS.SALES_INVOICE_EDIT];
  sent.invoices = [];
});

function unwrap<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

describe('sendInvoice', () => {
  it('issues a draft, mints the link once, and emails it in the merchant’s name', async () => {
    /* The logo is read from the organization row, not from the session —
     * so this sets it where deliverInvoice actually looks. */
    await prisma.organization.update({
      where: { id: ctx.organization.id },
      data: { logoUrl: 'https://cdn.example.com/logo.png' },
    });
    const created = await invoice(50_000);

    const result = await sendInvoice(created.id);
    expect(result.success).toBe(true);

    const row = await prisma.invoice.findUniqueOrThrow({
      where: { id: created.id },
      select: { status: true, publicToken: true, sentAt: true },
    });
    expect(row.status).not.toBe('DRAFT');
    expect(row.publicToken).toBeTruthy();
    expect(row.sentAt).not.toBeNull();

    expect(sent.invoices).toHaveLength(1);
    const email = sent.invoices[0];
    expect(email).toMatchObject({
      kind: 'issued',
      // The merchant's own name and logo — never the platform's.
      businessName: 'Adire Studio',
      businessLogoUrl: 'https://cdn.example.com/logo.png',
      invoiceNumber: created.invoiceNumber,
    });
    expect(String(email.invoiceUrl)).toContain(String(row.publicToken));

    /* Sending again must not mint a second link: the customer may have
     * bookmarked the first one. */
    await sendInvoice(created.id);
    const again = await prisma.invoice.findUniqueOrThrow({
      where: { id: created.id },
      select: { publicToken: true },
    });
    expect(again.publicToken).toBe(row.publicToken);
  });

  it('refuses when the customer has no email, and sends nothing', async () => {
    const created = await invoice(1_000, { customerId: namelessCustomerId });

    const result = await sendInvoice(created.id);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/no email/i);
    expect(sent.invoices).toHaveLength(0);

    // And it was not quietly issued on the way to failing.
    const row = await prisma.invoice.findUniqueOrThrow({
      where: { id: created.id },
      select: { status: true, sentAt: true },
    });
    expect(row).toMatchObject({ status: 'DRAFT', sentAt: null });
  });

  it('refuses a member without sales.invoice.edit', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW];
    const created = await invoice(1_000);
    const result = await sendInvoice(created.id);
    expect(result.success).toBe(false);
    expect(sent.invoices).toHaveLength(0);
  });

  it('exposes the link and the send dates to the merchant', async () => {
    const created = await invoice(20_000);
    await sendInvoice(created.id);

    const detail = unwrap(await getInvoice(created.id));
    expect(detail.publicUrl).toContain('/invoice/');
    expect(detail.sentAt).not.toBeNull();
    expect(detail.customerEmail).toContain('@');
  });
});

describe('sendInvoiceReminder', () => {
  it('chases an unpaid invoice, counting the days it is overdue', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    const created = await invoice(80_000, { dueDate: threeDaysAgo });
    await sendInvoice(created.id);
    sent.invoices = [];

    const result = await sendInvoiceReminder(created.id);
    expect(result.success).toBe(true);
    expect(sent.invoices[0]).toMatchObject({ kind: 'reminder', daysOverdue: 3 });

    const row = await prisma.invoice.findUniqueOrThrow({
      where: { id: created.id },
      select: { lastReminderAt: true },
    });
    expect(row.lastReminderAt).not.toBeNull();
  });

  it('won’t chase one that was never sent', async () => {
    const created = await invoice(5_000);
    const result = await sendInvoiceReminder(created.id);
    expect(result.success).toBe(false);
    expect(sent.invoices).toHaveLength(0);
  });

  it('won’t chase one that is already paid', async () => {
    const created = await invoice(10_000);
    await sendInvoice(created.id);
    await recordPayment(created.id, { amount: 10_000, method: 'BANK_TRANSFER' });
    sent.invoices = [];

    const result = await sendInvoiceReminder(created.id);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/already paid/i);
    expect(sent.invoices).toHaveLength(0);
  });
});

describe('the customer’s copy', () => {
  it('opens on the token, and shows what is still to pay', async () => {
    await prisma.merchantBankAccount.create({
      data: {
        organizationId: ctx.organization.id,
        bankName: 'Zenith',
        accountName: 'Adire Studio',
        accountNumber: '1234567890',
      },
    });

    const created = await invoice(100_000);
    await sendInvoice(created.id);
    await recordPayment(created.id, { amount: 40_000, method: 'BANK_TRANSFER' });

    const { publicToken } = await prisma.invoice.findUniqueOrThrow({
      where: { id: created.id },
      select: { publicToken: true },
    });

    const view = await getInvoiceByToken(ctx.organization.id, publicToken!);
    expect(view).not.toBeNull();
    expect(view).toMatchObject({
      invoiceNumber: created.invoiceNumber,
      totalAmount: 100_000,
      paidAmount: 40_000,
      outstanding: 60_000,
    });
    expect(view!.payments).toHaveLength(1);
    // Somewhere to send the rest.
    expect(view!.bankAccounts).toHaveLength(1);
  });

  it('stops offering bank details once it is settled', async () => {
    await prisma.merchantBankAccount.updateMany({
      where: { organizationId: ctx.organization.id },
      data: { isActive: true },
    });

    const created = await invoice(15_000);
    await sendInvoice(created.id);
    await recordPayment(created.id, { amount: 15_000, method: 'CASH' });

    const { publicToken } = await prisma.invoice.findUniqueOrThrow({
      where: { id: created.id },
      select: { publicToken: true },
    });
    const view = await getInvoiceByToken(ctx.organization.id, publicToken!);
    expect(view!.outstanding).toBe(0);
    expect(view!.bankAccounts).toEqual([]);
  });

  it('is a miss under another store’s domain', async () => {
    const created = await invoice(9_000);
    await sendInvoice(created.id);
    const { publicToken } = await prisma.invoice.findUniqueOrThrow({
      where: { id: created.id },
      select: { publicToken: true },
    });

    expect(await getInvoiceByToken(otherOrgId, publicToken!)).toBeNull();
  });

  it('answers the same way for a draft, a voided invoice and a wrong token', async () => {
    // A draft: it has no token at all, so there is nothing to open.
    const draft = await invoice(3_000);
    const draftRow = await prisma.invoice.findUniqueOrThrow({
      where: { id: draft.id },
      select: { publicToken: true },
    });
    expect(draftRow.publicToken).toBeNull();

    // A sent invoice that is then voided stops opening.
    const voided = await invoice(4_000);
    await sendInvoice(voided.id);
    const { publicToken } = await prisma.invoice.findUniqueOrThrow({
      where: { id: voided.id },
      select: { publicToken: true },
    });
    await prisma.invoice.update({ where: { id: voided.id }, data: { status: 'VOID' } });

    expect(await getInvoiceByToken(ctx.organization.id, publicToken!)).toBeNull();
    expect(await getInvoiceByToken(ctx.organization.id, 'not-a-real-token')).toBeNull();
    expect(await getInvoiceByToken(ctx.organization.id, '')).toBeNull();
  });

  it('cannot be opened by invoice number', async () => {
    const created = await invoice(7_000);
    await sendInvoice(created.id);

    /* The number is sequential and printed on the document. If it opened the
     * page, anyone could count through the store's invoices. */
    expect(await getInvoiceByToken(ctx.organization.id, created.invoiceNumber)).toBeNull();
  });
});
