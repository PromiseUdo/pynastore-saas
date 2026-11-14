/*
 * components/sales/account-statement-document.tsx
 *
 * A trade buyer's statement (ROADMAP 21.5): everything they owe the shop —
 * on-account orders and unpaid invoices together — oldest first, with what's
 * overdue. On the shared invoice paper (./invoice-paper.tsx), to print or
 * save as PDF and send.
 */
import { InvoiceBankAccounts, InvoiceLines, InvoicePaper, InvoiceParties, InvoiceTotals, type InvoiceFrom } from './invoice-paper';
import { formatDate, formatMoney } from '@/lib/format';
import type { AccountBalance } from '@/lib/trade/credit';

export function AccountStatementDocument({
  from,
  to,
  balance,
  currency,
  bankAccounts,
  asOf,
}: {
  from: InvoiceFrom;
  to: { businessName: string; contactName: string; email: string | null; phone: string | null; taxId: string | null };
  balance: AccountBalance;
  currency: string;
  bankAccounts: { bankName: string; accountName: string; accountNumber: string }[];
  asOf: Date;
}) {
  const money = (value: number) => formatMoney(value, currency);
  return (
    <InvoicePaper
      from={from}
      title="Statement"
      number={formatDate(asOf)}
      stamp={balance.overdue > 0 ? { label: `${money(balance.overdue)} overdue`, tone: 'overdue' } : { label: 'Up to date', tone: 'paid' }}
    >
      <InvoiceParties
        columns={[
          {
            label: 'Account of',
            strong: true,
            lines: [to.businessName, to.taxId ? `Tax ID ${to.taxId}` : null, `Attn: ${to.contactName}`, [to.email, to.phone].filter(Boolean).join(' · ')],
          },
          { label: 'As at', lines: [formatDate(asOf)] },
          { label: 'Owed', lines: [money(balance.owed)] },
        ]}
      />
      <InvoiceLines
        lines={balance.items.map((item) => ({
          description: `${item.kind === 'order' ? 'Order' : 'Invoice'} ${item.number}`,
          detail: [`Issued ${formatDate(item.issuedAt)}`, item.dueAt ? `${item.overdue ? 'Overdue since' : 'Due'} ${formatDate(item.dueAt)}` : null]
            .filter(Boolean)
            .join(' · '),
          quantity: '1',
          unitPrice: money(item.total),
          total: money(item.owed),
        }))}
      />
      <InvoiceTotals
        rows={[
          ...(balance.overdue > 0 ? [{ label: 'Overdue', value: money(balance.overdue) }] : []),
          { label: 'Total owed', value: money(balance.owed), kind: 'total' as const },
        ]}
      />
      {balance.owed > 0 && bankAccounts.length > 0 && (
        <InvoiceBankAccounts
          accounts={bankAccounts}
          intro={<>Transfer what you owe to the account below, quoting each order or invoice number as the reference.</>}
        />
      )}
    </InvoicePaper>
  );
}
