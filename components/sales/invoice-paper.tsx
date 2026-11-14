/*
 * components/sales/invoice-paper.tsx
 *
 * The pieces an A4 invoice is made of, shared by the two invoices a
 * customer can open: the merchant's own invoice (Sales → Invoices, opened
 * by its link) and the business invoice that comes with a trade order
 * (ROADMAP 21.6). Same paper, different facts — AGENTS §9.
 *
 * Plain neutral colours rather than either theme's tokens: a document is the
 * same on screen and on paper, and must stay legible printed in black and
 * white (no storefront tokens in the admin, no admin tokens in the
 * storefront — and a bill is neither). Everything is passed in already
 * worked out; nothing is computed here for show.
 */
import { PrintButton } from './print-button';

export type InvoiceStampTone = 'paid' | 'overdue' | 'neutral';

const STAMP: Record<InvoiceStampTone, string> = {
  paid: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  overdue: 'border-red-300 bg-red-50 text-red-800',
  neutral: 'border-neutral-300 bg-neutral-50 text-neutral-700',
};

export interface InvoiceFrom {
  name: string;
  logoUrl: string | null;
  address: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  /** extra lines under the contact details — a VAT number, say */
  extra?: string[];
}

/** The page: who it's from, what it is, its standing — then whatever the document says. */
export function InvoicePaper({
  from,
  title = 'Invoice',
  number,
  stamp,
  children,
}: {
  from: InvoiceFrom;
  title?: string;
  number: string;
  stamp: { label: string; tone: InvoiceStampTone };
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-neutral-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-[760px] bg-white px-8 py-10 text-neutral-900 shadow-sm print:max-w-none print:px-0 print:shadow-none">
        <div className="mb-6 flex justify-end">
          <PrintButton />
        </div>

        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-neutral-200 pb-6">
          <div className="min-w-0">
            {from.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={from.logoUrl} alt={from.name} className="mb-2 h-10 w-auto" />
            ) : (
              <p className="text-lg font-semibold">{from.name}</p>
            )}
            {from.address && <p className="whitespace-pre-line text-xs leading-relaxed text-neutral-500">{from.address}</p>}
            <p className="text-xs text-neutral-500">{[from.supportEmail, from.supportPhone].filter(Boolean).join(' · ')}</p>
            {from.extra?.map((line) => (
              <p key={line} className="text-xs text-neutral-500">
                {line}
              </p>
            ))}
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-widest text-neutral-500">{title}</p>
            <p className="text-lg font-semibold tabular-nums">{number}</p>
            <p className={`mt-1 inline-block rounded border px-2 py-0.5 text-xs font-medium ${STAMP[stamp.tone]}`}>
              {stamp.label}
            </p>
          </div>
        </header>

        {children}

        <footer className="mt-10 border-t border-neutral-200 pt-4 text-center text-xs text-neutral-500">
          {from.name}
          {from.supportEmail ? ` · ${from.supportEmail}` : ''}
        </footer>
      </div>
    </div>
  );
}

/** The "Billed to / Issued / Due" band: up to three columns of label + lines. */
export function InvoiceParties({ columns }: { columns: { label: string; lines: (string | null | undefined)[]; strong?: boolean }[] }) {
  return (
    <section className="grid gap-6 border-b border-neutral-200 py-6 sm:grid-cols-3">
      {columns.map((column) => {
        const [first, ...rest] = column.lines.filter((line): line is string => Boolean(line));
        return (
          <div key={column.label} className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-neutral-500">{column.label}</p>
            <p className={`mt-1 text-sm tabular-nums ${column.strong ? 'font-medium' : ''}`}>{first ?? '—'}</p>
            {rest.map((line) => (
              <p key={line} className="whitespace-pre-line text-xs text-neutral-500">
                {line}
              </p>
            ))}
          </div>
        );
      })}
    </section>
  );
}

export interface InvoicePaperLine {
  description: string;
  /** under the description: an option, "Wholesale price" */
  detail?: string | null;
  /** already formatted */
  quantity: string;
  unitPrice: string;
  total: string;
}

export function InvoiceLines({ lines }: { lines: InvoicePaperLine[] }) {
  return (
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
        {lines.map((line, index) => (
          <tr key={`${line.description}-${index}`} className="border-b border-neutral-100 align-top">
            <td className="py-2 pr-3">
              {line.description}
              {line.detail && <span className="block text-xs text-neutral-500">{line.detail}</span>}
            </td>
            <td className="py-2 text-right tabular-nums">{line.quantity}</td>
            <td className="py-2 text-right tabular-nums">{line.unitPrice}</td>
            <td className="py-2 text-right tabular-nums">{line.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export type InvoiceTotalRow = { label: string; value: string; kind?: 'line' | 'total' | 'subtotal' | 'note' };

/** The column of sums on the right. `total` rows are ruled and bold; `note` rows are small print. */
export function InvoiceTotals({ rows }: { rows: InvoiceTotalRow[] }) {
  return (
    <div className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
      {rows.map((row) =>
        row.kind === 'total' ? (
          <div key={row.label} className="flex justify-between border-t border-neutral-300 pt-2 text-base font-semibold">
            <span>{row.label}</span>
            <span className="tabular-nums">{row.value}</span>
          </div>
        ) : row.kind === 'subtotal' ? (
          <div key={row.label} className="flex justify-between border-t border-neutral-300 pt-2 font-semibold">
            <span>{row.label}</span>
            <span className="tabular-nums">{row.value}</span>
          </div>
        ) : row.kind === 'note' ? (
          <div key={row.label} className="flex justify-between gap-4 text-xs text-neutral-500">
            <span>{row.label}</span>
            <span className="tabular-nums">{row.value}</span>
          </div>
        ) : (
          <div key={row.label} className="flex justify-between gap-4">
            <span className="text-neutral-600">{row.label}</span>
            <span className="tabular-nums">{row.value}</span>
          </div>
        ),
      )}
    </div>
  );
}

/** A titled section further down the page: payments, how to pay, notes. */
export function InvoiceSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-t border-neutral-200 pt-6">
      {title && <h2 className="text-xs uppercase tracking-widest text-neutral-500">{title}</h2>}
      {children}
    </section>
  );
}

/** Where to send the money: the merchant's published accounts, quoting the reference. */
export function InvoiceBankAccounts({
  intro,
  accounts,
  after,
}: {
  intro: React.ReactNode;
  accounts: { bankName: string; accountName: string; accountNumber: string }[];
  after?: React.ReactNode;
}) {
  return (
    <InvoiceSection title="How to pay">
      <p className="mt-1 text-sm text-neutral-600">{intro}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {accounts.map((account, index) => (
          <div key={index} className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm">
            <p className="text-neutral-600">{account.bankName}</p>
            <p className="text-neutral-600">{account.accountName}</p>
            <p className="mt-0.5 text-base font-semibold tracking-wide tabular-nums">{account.accountNumber}</p>
          </div>
        ))}
      </div>
      {after && <p className="mt-2 text-xs text-neutral-500">{after}</p>}
    </InvoiceSection>
  );
}
