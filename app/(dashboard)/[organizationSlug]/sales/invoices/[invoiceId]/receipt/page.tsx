/*
 * A receipt for a paid invoice.
 *
 * Distinct from the invoice itself: an invoice asks for money, a receipt
 * says it arrived. It lists what the merchant actually recorded receiving,
 * so it can only exist once something has been.
 *
 * Same narrow print-first shape as the counter-sale receipt.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { getInvoice } from '@/features/sales/actions';
import { getOrganizationSettings } from '@/features/settings/organization';
import { ReceiptDocument } from '@/components/sales/receipt-document';
import { enumLabel, formatDate, formatMoney } from '@/lib/format';

export const metadata: Metadata = { title: 'Receipt' };

export default async function InvoiceReceiptPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const ctx = await getOrganizationContext();
  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="receipts" />;
  }

  const { invoiceId } = await params;
  const [result, settings] = await Promise.all([getInvoice(invoiceId), getOrganizationSettings()]);
  if (!result.success) notFound();

  const invoice = result.data;
  const business = settings.success ? settings.data : null;

  /* Nothing received, nothing to receipt. Saying so beats printing a page
   * that claims money changed hands. */
  if (invoice.payments.length === 0) notFound();

  const money = (value: number) => formatMoney(value, invoice.currency);
  const lastPayment = invoice.payments[0];

  return (
    <ReceiptDocument
      businessName={ctx.organization.name}
      businessAddress={business?.businessAddress ?? null}
      businessPhone={business?.supportPhone ?? null}
      title="Receipt"
      facts={[
        { label: 'Receipt for', value: invoice.invoiceNumber },
        { label: 'Date', value: formatDate(lastPayment.createdAt) },
        { label: 'Customer', value: invoice.customerName },
      ]}
      lines={invoice.lineItems.map((line) => ({
        name: line.description,
        variantName: null,
        quantity: line.quantity,
        unitPrice: money(line.unitPrice),
        total: money(line.totalPrice),
      }))}
      totals={[
        { label: 'Subtotal', value: money(invoice.subtotal) },
        ...(invoice.taxAmount > 0 ? [{ label: 'Tax', value: money(invoice.taxAmount) }] : []),
      ]}
      total={{ label: 'Total', value: money(invoice.totalAmount) }}
      footerFacts={[
        ...invoice.payments.map((payment) => ({
          label: `Paid · ${enumLabel(payment.method)}`,
          value: `${money(payment.amount)} on ${formatDate(payment.createdAt)}`,
        })),
        {
          label: 'Balance',
          value:
            invoice.totalAmount - invoice.paidAmount <= 0
              ? 'Paid in full'
              : `${money(invoice.totalAmount - invoice.paidAmount)} still to pay`,
        },
      ]}
      note={invoice.notes}
    />
  );
}
