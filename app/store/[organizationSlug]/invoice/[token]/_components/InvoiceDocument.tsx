/*
 * The invoice itself — one printable page.
 *
 * The paper (header, lines, sums, how to pay) is shared with the business
 * invoice a trade order comes with: components/sales/invoice-paper.tsx.
 *
 * Nothing here is computed for show. "Still to pay" is the total less what
 * the merchant has recorded receiving; if they haven't recorded it, it isn't
 * claimed.
 */
import {
  InvoiceBankAccounts,
  InvoiceLines,
  InvoicePaper,
  InvoiceParties,
  InvoiceSection,
  InvoiceTotals,
  type InvoiceTotalRow,
} from '@/components/sales/invoice-paper';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { enumLabel } from '@/lib/format';
import type { PublicInvoice } from '@/lib/storefront/invoices/read';

export function InvoiceDocument({ invoice }: { invoice: PublicInvoice }) {
  const money = (value: number) => formatMoney(value, invoice.currency);
  const settled = invoice.outstanding <= 0;

  const stamp = settled
    ? { label: `Paid${invoice.paidAt ? ` · ${formatDate(invoice.paidAt)}` : ''}`, tone: 'paid' as const }
    : invoice.overdue
      ? { label: 'Overdue', tone: 'overdue' as const }
      : { label: enumLabel(invoice.status), tone: 'neutral' as const };

  const totals: InvoiceTotalRow[] = [{ label: 'Subtotal', value: money(invoice.subtotal) }];
  if (invoice.taxAmount > 0) totals.push({ label: 'Tax', value: money(invoice.taxAmount) });
  totals.push({ label: 'Total', value: money(invoice.totalAmount), kind: 'total' });
  if (invoice.paidAmount > 0) {
    totals.push({ label: 'Paid', value: `−${money(invoice.paidAmount)}` });
    totals.push({ label: 'Still to pay', value: money(invoice.outstanding), kind: 'subtotal' });
  }

  return (
    <InvoicePaper from={invoice.business} number={invoice.invoiceNumber} stamp={stamp}>
      <InvoiceParties
        columns={[
          {
            label: 'Billed to',
            strong: true,
            lines: [
              invoice.customer.name,
              invoice.customer.address,
              [invoice.customer.email, invoice.customer.phone].filter(Boolean).join(' · '),
            ],
          },
          { label: 'Issued', lines: [invoice.issuedAt ? formatDate(invoice.issuedAt) : null] },
          { label: 'Due', lines: [invoice.dueDate ? formatDate(invoice.dueDate) : null] },
        ]}
      />

      <InvoiceLines
        lines={invoice.lines.map((line) => ({
          description: line.description,
          quantity: formatNumber(line.quantity),
          unitPrice: money(line.unitPrice),
          total: money(line.totalPrice),
        }))}
      />

      <InvoiceTotals rows={totals} />

      {/* ── What the merchant has recorded receiving ──────────────── */}
      {invoice.payments.length > 0 && (
        <InvoiceSection title="Payments received">
          <ul className="mt-2 space-y-1 text-sm">
            {invoice.payments.map((payment, index) => (
              <li key={index} className="flex justify-between gap-4">
                <span className="text-neutral-600">
                  {formatDate(payment.receivedAt)} · {enumLabel(payment.method)}
                  {payment.reference ? ` · ${payment.reference}` : ''}
                </span>
                <span className="tabular-nums">{money(payment.amount)}</span>
              </li>
            ))}
          </ul>
        </InvoiceSection>
      )}

      {/* ── How to pay it ─────────────────────────────────────────── */}
      {invoice.bankAccounts.length > 0 && (
        <InvoiceBankAccounts
          accounts={invoice.bankAccounts}
          intro={
            <>
              Transfer {money(invoice.outstanding)} to the account below, quoting{' '}
              <span className="font-medium text-neutral-900">{invoice.invoiceNumber}</span> as the reference.
            </>
          }
          /* Said plainly: the money moves between the customer and the
           * merchant's bank, and only the merchant marking it received
           * changes anything here. */
          after={`This page updates once ${invoice.business.name} confirms your payment has arrived.`}
        />
      )}

      {invoice.notes && (
        <InvoiceSection>
          <p className="whitespace-pre-line text-sm text-neutral-600">{invoice.notes}</p>
        </InvoiceSection>
      )}
    </InvoicePaper>
  );
}
