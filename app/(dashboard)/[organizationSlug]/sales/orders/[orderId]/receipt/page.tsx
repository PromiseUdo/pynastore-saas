/*
 * A receipt for an order, for printing or handing over.
 *
 * The document itself is components/sales/receipt-document.tsx, shared with
 * the paid-invoice receipt. This page's whole job is to turn one order into
 * the facts that go on it — everything here is already recorded against the
 * order; nothing is computed for the paper.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { getStoreOrder } from '@/features/sales/orders';
import { getOrganizationSettings } from '@/features/settings/organization';
import { ReceiptDocument, type ReceiptFact } from '@/components/sales/receipt-document';
import { formatDate, formatMoney } from '@/lib/format';
import { COUNTER_PAYMENT_LABEL, ORDER_CHANNEL_LABEL, PAYMENT_METHOD_LABEL } from '@/lib/sales/order-labels';

export const metadata: Metadata = { title: 'Receipt' };

export default async function ReceiptPage({ params }: { params: Promise<{ orderId: string }> }) {
  const ctx = await getOrganizationContext();
  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="receipts" />;
  }

  const { orderId } = await params;
  const [result, settings] = await Promise.all([getStoreOrder(orderId), getOrganizationSettings()]);
  if (!result.success) notFound();

  const order = result.data;
  const business = settings.success ? settings.data : null;
  const money = (value: number) => formatMoney(value, order.currency);

  const paymentLabel =
    COUNTER_PAYMENT_LABEL[order.paymentMethod] ?? PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod;

  const facts: ReceiptFact[] = [
    { label: 'Receipt', value: order.reference },
    { label: 'Date', value: formatDate(order.placedAt) },
    ...(order.storeName ? [{ label: 'Store', value: order.storeName }] : []),
    ...(order.soldByName ? [{ label: 'Served by', value: order.soldByName }] : []),
    ...(order.customerName ? [{ label: 'Customer', value: order.customerName }] : []),
    { label: 'Sale', value: ORDER_CHANNEL_LABEL[order.channel] ?? order.channel },
  ];

  const totals: ReceiptFact[] = [{ label: 'Subtotal', value: money(order.subtotal) }];
  if (order.discount > 0) totals.push({ label: 'Discount', value: `−${money(order.discount)}` });
  if (order.deliveryFee !== null && order.deliveryFee > 0) {
    totals.push({ label: 'Delivery', value: money(order.deliveryFee) });
  }
  if (order.taxAmount > 0) totals.push({ label: 'Tax', value: money(order.taxAmount) });

  return (
    <ReceiptDocument
      businessName={ctx.organization.name}
      businessAddress={business?.businessAddress ?? null}
      businessPhone={business?.supportPhone ?? null}
      title="Receipt"
      facts={facts}
      lines={order.lines.map((line) => ({
        name: line.name,
        variantName: line.variantName,
        quantity: line.quantity,
        unitPrice: money(line.unitPrice),
        total: money(line.totalPrice),
      }))}
      totals={totals}
      total={{ label: 'Total', value: money(order.totalAmount) }}
      footerFacts={[
        { label: 'Paid by', value: paymentLabel },
        {
          label: 'Status',
          // Only what was recorded: an unpaid sale says so.
          value: order.paidAt ? `Paid ${formatDate(order.paidAt)}` : 'Not paid yet',
        },
      ]}
      note={order.note}
    />
  );
}
