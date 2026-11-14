/*
 * components/sales/trade-invoice-document.tsx
 *
 * The business invoice for a trade order (ROADMAP 21.6): the buyer opens it
 * from their order or the order email; the merchant opens the same page
 * from the order in Sales. One document, read off the order
 * (lib/storefront/orders/trade-invoice.ts) — every figure is what the order
 * stored.
 *
 * VAT is shown the way the order charged it: added to wholesale prices as a
 * line of its own (21.2), and VAT already inside prices as small print under
 * the total (14.1). The buyer's tax ID is on it either way.
 */
import {
  InvoiceBankAccounts,
  InvoiceLines,
  InvoicePaper,
  InvoiceParties,
  InvoiceSection,
  InvoiceTotals,
  type InvoiceStampTone,
  type InvoiceTotalRow,
} from './invoice-paper';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import type { TradeInvoice } from '@/lib/storefront/orders/trade-invoice';

function stampFor(invoice: TradeInvoice): { label: string; tone: InvoiceStampTone } {
  if (invoice.cancelled) return { label: 'Cancelled', tone: 'neutral' };
  if (invoice.paymentStatus === 'PAID') {
    return { label: `Paid${invoice.paidAt ? ` · ${formatDate(invoice.paidAt)}` : ''}`, tone: 'paid' };
  }
  if (invoice.paymentStatus === 'FAILED') return { label: invoice.paymentStatusLabel, tone: 'overdue' };
  // On account (21.5): due by a date, or past it.
  if (invoice.account && invoice.paymentStatus === 'ON_ACCOUNT') {
    return invoice.account.overdue
      ? { label: 'Overdue', tone: 'overdue' }
      : { label: invoice.account.dueAt ? `Due ${formatDate(invoice.account.dueAt)}` : 'On account', tone: 'neutral' };
  }
  return { label: invoice.paymentStatusLabel, tone: 'neutral' };
}

export function TradeInvoiceDocument({ invoice }: { invoice: TradeInvoice }) {
  const money = (value: number) => formatMoney(value, invoice.currency);

  const totals: InvoiceTotalRow[] = [{ label: 'Subtotal', value: money(invoice.subtotal) }];
  if (invoice.discount > 0) {
    totals.push({ label: invoice.discountLabel ? `Discount (${invoice.discountLabel})` : 'Discount', value: `−${money(invoice.discount)}` });
  }
  const unpricedDelivery = invoice.deliveryArranged && invoice.deliveryFee === null;
  if (unpricedDelivery) {
    // Delivery to be arranged (21.4B), not priced yet: said, never guessed.
    totals.push({ label: 'Delivery', value: 'To be arranged' });
  } else if (invoice.deliveryFee !== null) {
    totals.push({
      label: invoice.deliveryArranged ? 'Delivery (arranged by the store)' : 'Delivery',
      value: invoice.deliveryFee > 0 ? money(invoice.deliveryFee) : 'Free',
    });
  }
  if (invoice.vatAdded > 0) totals.push({ label: 'VAT', value: money(invoice.vatAdded) });
  totals.push({ label: unpricedDelivery ? 'Total before delivery' : 'Total', value: money(invoice.total), kind: 'total' });
  if (invoice.vatIncluded > 0) totals.push({ label: 'Includes VAT', value: money(invoice.vatIncluded), kind: 'note' });
  // On account (21.5): what the store has recorded receiving, and what's left.
  if (invoice.account && invoice.account.paid > 0) {
    totals.push({ label: 'Paid', value: `−${money(invoice.account.paid)}` });
    totals.push({ label: 'Still to pay', value: money(invoice.account.outstanding), kind: 'subtotal' });
  }

  const paymentLine =
    invoice.paymentStatus === 'PAID' || invoice.cancelled
      ? invoice.paymentMethodLabel
      : invoice.paymentStatus === 'DUE_ON_DELIVERY'
        ? 'Due on delivery'
        : invoice.paymentStatus === 'ON_ACCOUNT' && invoice.account?.dueAt
          ? `Due by ${formatDate(invoice.account.dueAt)}`
          : invoice.paymentStatusLabel;

  return (
    <InvoicePaper
      from={{
        name: invoice.seller.name,
        logoUrl: invoice.seller.logoUrl,
        address: invoice.seller.address,
        supportEmail: invoice.seller.supportEmail,
        supportPhone: invoice.seller.supportPhone,
        extra: invoice.seller.vatNumber ? [`VAT number ${invoice.seller.vatNumber}`] : [],
      }}
      number={invoice.number}
      stamp={stampFor(invoice)}
    >
      <InvoiceParties
        columns={[
          {
            label: 'Billed to',
            strong: true,
            lines: [
              invoice.buyer.businessName,
              invoice.buyer.taxId ? `Tax ID ${invoice.buyer.taxId}` : null,
              invoice.buyer.cacNumber ? `RC/BN ${invoice.buyer.cacNumber}` : null,
              invoice.buyer.contactName ? `Attn: ${invoice.buyer.contactName}` : null,
              [invoice.buyer.email, invoice.buyer.phone].filter(Boolean).join(' · '),
            ],
          },
          { label: 'Issued', lines: [formatDate(invoice.issuedAt), `Order ${invoice.number}`] },
          { label: 'Payment', lines: [paymentLine, invoice.paymentStatus === 'PAID' || invoice.cancelled ? null : invoice.paymentMethodLabel] },
        ]}
      />

      <InvoiceLines
        lines={invoice.lines.map((line) => ({
          description: line.name,
          detail: [line.variantName, line.atWholesalePrice ? 'Wholesale price' : null].filter(Boolean).join(' · ') || null,
          quantity: formatNumber(line.quantity),
          unitPrice: money(line.unitPrice),
          total: money(line.totalPrice),
        }))}
      />

      <InvoiceTotals rows={totals} />

      {invoice.transferAccounts.length > 0 && (
        <InvoiceBankAccounts
          accounts={invoice.transferAccounts}
          intro={
            <>
              Transfer {money(invoice.account ? invoice.account.outstanding : invoice.total)} to the account below
              {invoice.account?.dueAt && invoice.paymentStatus === 'ON_ACCOUNT' ? ` by ${formatDate(invoice.account.dueAt)}` : ''}, quoting{' '}
              <span className="font-medium text-neutral-900">{invoice.number}</span> as the reference.
            </>
          }
          after={`This invoice shows as paid once ${invoice.seller.name} confirms your transfer has arrived.`}
        />
      )}

      {invoice.deliverTo.length > 0 && (
        <InvoiceSection title="Delivery">
          <div className="mt-1 text-sm text-neutral-600">
            {invoice.deliveryMethod && <p className="font-medium text-neutral-900">{invoice.deliveryMethod}</p>}
            {invoice.deliverTo.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </InvoiceSection>
      )}
    </InvoicePaper>
  );
}
