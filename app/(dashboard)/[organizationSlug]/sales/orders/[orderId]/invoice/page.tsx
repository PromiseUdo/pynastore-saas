/*
 * The business invoice for a trade order (ROADMAP 21.6), the merchant's copy.
 *
 * The same document the buyer opens from their order
 * (components/sales/trade-invoice-document.tsx), read off the order — so
 * what the merchant prints or forwards is exactly what the buyer was sent.
 * An order that isn't a trade order has no business invoice: its receipt is
 * at ../receipt.
 */
import type { Metadata } from 'next';
import { printableTitle } from '@/lib/print-title';
import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { tradeInvoiceForOrder } from '@/lib/storefront/orders/trade-invoice';
import { TradeInvoiceDocument } from '@/components/sales/trade-invoice-document';

export async function generateMetadata({ params }: { params: Promise<{ orderId: string }> }): Promise<Metadata> {
  return printableTitle({ kind: 'invoice', orderId: (await params).orderId });
}

export default async function TradeOrderInvoicePage({ params }: { params: Promise<{ orderId: string }> }) {
  const ctx = await getOrganizationContext();
  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="invoices" />;
  }

  const { orderId } = await params;
  const invoice = await tradeInvoiceForOrder(ctx.organization.id, orderId);
  if (!invoice) notFound();

  return <TradeInvoiceDocument invoice={invoice} />;
}
