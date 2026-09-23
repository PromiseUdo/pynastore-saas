/*
 * The invoice itself — one printable page.
 *
 * Plain neutral colours rather than either theme's tokens: this is a
 * document, it is the same on screen and on paper, and it must stay legible
 * when a customer prints it in black and white (AGENTS: no storefront tokens
 * in the admin, no admin tokens in the storefront — and a bill is neither).
 *
 * Nothing here is computed for show. "Still to pay" is the total less what
 * the merchant has recorded receiving; if they haven't recorded it, it isn't
 * claimed.
 */
import { PrintButton } from '@/components/sales/print-button';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { enumLabel } from '@/lib/format';
import type { PublicInvoice } from '@/lib/storefront/invoices/read';

export function InvoiceDocument({ invoice }: { invoice: PublicInvoice }) {
  const money = (value: number) => formatMoney(value, invoice.currency);
  const settled = invoice.outstanding <= 0;

  return (
    <div className="min-h-screen bg-neutral-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-[760px] bg-white px-8 py-10 text-neutral-900 shadow-sm print:max-w-none print:px-0 print:shadow-none">
        <div className="mb-6 flex justify-end">
          <PrintButton />
        </div>

        {/* ── Who it's from, and what it is ─────────────────────────── */}
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-neutral-200 pb-6">
          <div className="min-w-0">
            {invoice.business.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={invoice.business.logoUrl} alt={invoice.business.name} className="mb-2 h-10 w-auto" />
            ) : (
              <p className="text-lg font-semibold">{invoice.business.name}</p>
            )}
            {invoice.business.address && (
              <p className="whitespace-pre-line text-xs leading-relaxed text-neutral-500">
                {invoice.business.address}
              </p>
            )}
            <p className="text-xs text-neutral-500">
              {[invoice.business.supportEmail, invoice.business.supportPhone].filter(Boolean).join(' · ')}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-widest text-neutral-500">Invoice</p>
            <p className="text-lg font-semibold tabular-nums">{invoice.invoiceNumber}</p>
            {settled ? (
              <p className="mt-1 inline-block rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                Paid{invoice.paidAt ? ` · ${formatDate(invoice.paidAt)}` : ''}
              </p>
            ) : invoice.overdue ? (
              <p className="mt-1 inline-block rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800">
                Overdue
              </p>
            ) : (
              <p className="mt-1 inline-block rounded border border-neutral-300 bg-neutral-50 px-2 py-0.5 text-xs font-medium text-neutral-700">
                {enumLabel(invoice.status)}
              </p>
            )}
          </div>
        </header>

        {/* ── Who it's to, and when ─────────────────────────────────── */}
        <section className="grid gap-6 border-b border-neutral-200 py-6 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-neutral-500">Billed to</p>
            <p className="mt-1 text-sm font-medium">{invoice.customer.name}</p>
            {invoice.customer.address && (
              <p className="whitespace-pre-line text-xs text-neutral-500">{invoice.customer.address}</p>
            )}
            <p className="text-xs text-neutral-500">
              {[invoice.customer.email, invoice.customer.phone].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-neutral-500">Issued</p>
            <p className="mt-1 text-sm tabular-nums">{formatDate(invoice.issuedAt)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-neutral-500">Due</p>
            <p className="mt-1 text-sm tabular-nums">{invoice.dueDate ? formatDate(invoice.dueDate) : '—'}</p>
          </div>
        </section>

        {/* ── What it's for ─────────────────────────────────────────── */}
        <table className="w-full border-collapse py-6 text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-widest text-neutral-500">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Unit price</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={`${line.description}-${index}`} className="border-b border-neutral-100">
                <td className="py-2 pr-3">{line.description}</td>
                <td className="py-2 text-right tabular-nums">{formatNumber(line.quantity)}</td>
                <td className="py-2 text-right tabular-nums">{money(line.unitPrice)}</td>
                <td className="py-2 text-right tabular-nums">{money(line.totalPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── What it comes to ──────────────────────────────────────── */}
        <div className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
          <Line label="Subtotal" value={money(invoice.subtotal)} />
          {invoice.taxAmount > 0 && <Line label="Tax" value={money(invoice.taxAmount)} />}
          <div className="flex justify-between border-t border-neutral-300 pt-2 text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{money(invoice.totalAmount)}</span>
          </div>
          {invoice.paidAmount > 0 && (
            <>
              <Line label="Paid" value={`−${money(invoice.paidAmount)}`} />
              <div className="flex justify-between border-t border-neutral-300 pt-2 font-semibold">
                <span>Still to pay</span>
                <span className="tabular-nums">{money(invoice.outstanding)}</span>
              </div>
            </>
          )}
        </div>

        {/* ── What the merchant has recorded receiving ──────────────── */}
        {invoice.payments.length > 0 && (
          <section className="mt-8 border-t border-neutral-200 pt-6">
            <h2 className="text-xs uppercase tracking-widest text-neutral-500">Payments received</h2>
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
          </section>
        )}

        {/* ── How to pay it ─────────────────────────────────────────── */}
        {invoice.bankAccounts.length > 0 && (
          <section className="mt-8 border-t border-neutral-200 pt-6">
            <h2 className="text-xs uppercase tracking-widest text-neutral-500">How to pay</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Transfer {money(invoice.outstanding)} to the account below, quoting{' '}
              <span className="font-medium text-neutral-900">{invoice.invoiceNumber}</span> as the reference.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {invoice.bankAccounts.map((account, index) => (
                <div key={index} className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm">
                  <p className="text-neutral-600">{account.bankName}</p>
                  <p className="text-neutral-600">{account.accountName}</p>
                  <p className="mt-0.5 text-base font-semibold tracking-wide tabular-nums">
                    {account.accountNumber}
                  </p>
                </div>
              ))}
            </div>
            {/* Said plainly: the money moves between the customer and the
              * merchant's bank, and only the merchant marking it received
              * changes anything here. */}
            <p className="mt-2 text-xs text-neutral-500">
              This page updates once {invoice.business.name} confirms your payment has arrived.
            </p>
          </section>
        )}

        {invoice.notes && (
          <section className="mt-8 border-t border-neutral-200 pt-6">
            <p className="whitespace-pre-line text-sm text-neutral-600">{invoice.notes}</p>
          </section>
        )}

        <footer className="mt-10 border-t border-neutral-200 pt-4 text-center text-xs text-neutral-500">
          {invoice.business.name}
          {invoice.business.supportEmail ? ` · ${invoice.business.supportEmail}` : ''}
        </footer>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-neutral-600">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
