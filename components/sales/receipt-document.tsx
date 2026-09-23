/*
 * components/sales/receipt-document.tsx
 *
 * A receipt, for handing over or printing.
 *
 * Shared by the counter sale and the paid invoice, because the second one
 * proved they are the same document with different facts at the top
 * (AGENTS §9). Deliberately outside the dashboard's look: no sidebar, no
 * cards, narrow column, black on white. A thermal printer or an A5 sheet is
 * the target, not a browser window.
 *
 * Everything it shows is passed in already formatted, by a server component
 * that read it off the record. Nothing is computed here for the paper.
 */
import { PrintButton } from './print-button';

export type ReceiptFact = { label: string; value: string };

export type ReceiptLine = {
  name: string;
  variantName: string | null;
  quantity: number;
  /** already formatted */
  unitPrice: string;
  total: string;
};

export function ReceiptDocument({
  businessName,
  businessAddress,
  businessPhone,
  title,
  facts,
  lines,
  totals,
  total,
  footerFacts,
  note,
}: {
  businessName: string;
  businessAddress: string | null;
  businessPhone: string | null;
  title: string;
  /** what this is and who it's for */
  facts: ReceiptFact[];
  lines: ReceiptLine[];
  /** subtotal, discount, tax — whatever applies */
  totals: ReceiptFact[];
  total: ReceiptFact;
  /** how it was paid, and anything still owed */
  footerFacts: ReceiptFact[];
  note?: string | null;
}) {
  return (
    <div className="mx-auto max-w-[420px] bg-white px-6 py-8 text-black print:max-w-none print:px-0 print:py-0">
      <div className="mb-6 flex justify-end print:hidden">
        <PrintButton />
      </div>

      <header className="text-center">
        <h1 className="text-base font-semibold">{businessName}</h1>
        {businessAddress && (
          <p className="mt-0.5 whitespace-pre-line text-[11px] leading-snug">{businessAddress}</p>
        )}
        {businessPhone && <p className="text-[11px]">{businessPhone}</p>}
        <p className="mt-2 text-[11px] uppercase tracking-widest">{title}</p>
      </header>

      <Divider />

      <dl className="space-y-0.5 text-[11px]">
        {facts.map((fact) => (
          <Row key={fact.label} {...fact} />
        ))}
      </dl>

      <Divider />

      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-black/30 text-left">
            <th className="pb-1 font-medium">Item</th>
            <th className="pb-1 text-right font-medium">Qty</th>
            <th className="pb-1 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.name}-${index}`} className="align-top">
              <td className="py-1 pr-2">
                {line.name}
                {line.variantName ? <span className="block opacity-70">{line.variantName}</span> : null}
                <span className="block opacity-70">{line.unitPrice} each</span>
              </td>
              <td className="py-1 text-right tabular-nums">{line.quantity}</td>
              <td className="py-1 text-right tabular-nums">{line.total}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Divider className="my-3" />

      <dl className="space-y-0.5 text-[11px]">
        {totals.map((line) => (
          <Row key={line.label} {...line} />
        ))}
      </dl>

      <div className="mt-2 flex justify-between border-t border-black pt-2 text-sm font-semibold">
        <span>{total.label}</span>
        <span className="tabular-nums">{total.value}</span>
      </div>

      <dl className="mt-3 space-y-0.5 text-[11px]">
        {footerFacts.map((fact, index) => (
          <Row key={`${fact.label}-${index}`} {...fact} />
        ))}
      </dl>

      {note && <p className="mt-3 text-[11px] italic">{note}</p>}

      <p className="mt-6 text-center text-[11px]">Thank you.</p>
    </div>
  );
}

function Divider({ className = 'my-4' }: { className?: string }) {
  return <div className={`${className} border-t border-dashed border-black/30`} />;
}

function Row({ label, value }: ReceiptFact) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="opacity-70">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
