/*
 * lib/data-rights/workspace-export.ts
 *
 * A workspace's own records as spreadsheets (ROADMAP 13.8) — what an Owner
 * takes with them before closing, or keeps as their own copy: customers,
 * products, orders (one row per item) and invoices. Plain CSV through
 * lib/csv.ts, which also stops a cell from running as a spreadsheet formula.
 */
import { prisma } from '@/lib/prisma';
import { toCsv } from '@/lib/csv';
import { enumLabel } from '@/lib/format';

export const WORKSPACE_DATASETS = {
  customers: 'Customers',
  products: 'Products',
  orders: 'Orders',
  invoices: 'Invoices',
} as const;

export type WorkspaceDataset = keyof typeof WORKSPACE_DATASETS;

export function isWorkspaceDataset(value: string): value is WorkspaceDataset {
  return Object.hasOwn(WORKSPACE_DATASETS, value);
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');
const money = (n: unknown) => (n === null || n === undefined ? '' : Number(n).toFixed(2));

export async function workspaceCsv(organizationId: string, dataset: WorkspaceDataset): Promise<string> {
  switch (dataset) {
    case 'customers': {
      const rows = await prisma.customer.findMany({ where: { organizationId, mergedIntoId: null }, orderBy: { createdAt: 'asc' } });
      return toCsv(rows, [
        { header: 'Name', value: (r) => r.name },
        { header: 'Email', value: (r) => r.email },
        { header: 'Phone', value: (r) => r.phone },
        { header: 'Address', value: (r) => r.address },
        { header: 'Tax ID', value: (r) => r.taxId },
        { header: 'Agreed to marketing', value: (r) => (r.marketingConsent ? 'Yes' : 'No') },
        { header: 'Online account', value: (r) => (r.accountDeletedAt ? 'Deleted by the customer' : r.passwordHash || r.emailVerifiedAt ? 'Yes' : 'No') },
        { header: 'Tags', value: (r) => r.tags.join('; ') },
        { header: 'Notes', value: (r) => r.notes },
        { header: 'Added', value: (r) => day(r.createdAt) },
      ]);
    }
    case 'products': {
      const rows = await prisma.inventoryItem.findMany({
        where: { organizationId },
        orderBy: [{ name: 'asc' }],
        include: { category: { select: { name: true } }, brand: { select: { name: true } }, parentItem: { select: { name: true } } },
      });
      return toCsv(rows, [
        { header: 'Name', value: (r) => r.name },
        { header: 'Variant of', value: (r) => r.parentItem?.name },
        { header: 'SKU', value: (r) => r.sku },
        { header: 'Category', value: (r) => r.category?.name },
        { header: 'Brand', value: (r) => r.brand?.name },
        { header: 'Price', value: (r) => money(r.sellingPrice) },
        { header: 'Average cost', value: (r) => money(r.averageCost) },
        { header: 'Status', value: (r) => enumLabel(r.status) },
        { header: 'On the online store', value: (r) => (r.isPublished ? 'Yes' : 'No') },
      ]);
    }
    case 'orders': {
      const orders = await prisma.order.findMany({
        where: { organizationId },
        orderBy: { placedAt: 'asc' },
        include: { lineItems: true },
      });
      const rows = orders.flatMap((o) => o.lineItems.map((l) => ({ o, l })));
      return toCsv(rows, [
        { header: 'Order', value: ({ o }) => o.reference },
        { header: 'Placed', value: ({ o }) => day(o.placedAt) },
        { header: 'Channel', value: ({ o }) => enumLabel(o.channel) },
        { header: 'Status', value: ({ o }) => enumLabel(o.status) },
        { header: 'Payment', value: ({ o }) => enumLabel(o.paymentStatus) },
        { header: 'Customer', value: ({ o }) => [o.firstName, o.lastName].filter(Boolean).join(' ') },
        { header: 'Email', value: ({ o }) => o.email },
        { header: 'Phone', value: ({ o }) => o.phone },
        { header: 'Deliver to', value: ({ o }) => [o.shipLine1, o.shipLine2, o.shipCity, o.shipState].filter(Boolean).join(', ') },
        { header: 'Item', value: ({ l }) => (l.variantName ? `${l.name} (${l.variantName})` : l.name) },
        { header: 'SKU', value: ({ l }) => l.sku },
        { header: 'Quantity', value: ({ l }) => l.quantity },
        { header: 'Unit price', value: ({ l }) => money(l.unitPrice) },
        { header: 'Line total', value: ({ l }) => money(l.totalPrice) },
        { header: 'Order total', value: ({ o }) => money(o.totalAmount) },
        { header: 'Currency', value: ({ o }) => o.currency },
      ]);
    }
    case 'invoices': {
      const rows = await prisma.invoice.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
        include: { customer: { select: { name: true } } },
      });
      return toCsv(rows, [
        { header: 'Invoice', value: (r) => r.invoiceNumber },
        { header: 'Customer', value: (r) => r.customer.name },
        { header: 'Status', value: (r) => enumLabel(r.status) },
        { header: 'Issued', value: (r) => day(r.createdAt) },
        { header: 'Due', value: (r) => day(r.dueDate) },
        { header: 'Subtotal', value: (r) => money(r.subtotal) },
        { header: 'Tax', value: (r) => money(r.taxAmount) },
        { header: 'Total', value: (r) => money(r.totalAmount) },
        { header: 'Paid', value: (r) => money(r.paidAmount) },
        { header: 'Currency', value: (r) => r.currency },
      ]);
    }
  }
}
