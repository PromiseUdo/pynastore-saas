'use client';

/*
 * Where to send a bank transfer, for an order waiting on one.
 *
 * Everything a shopper needs to make the payment from their banking app
 * without coming back here: the exact amount, the account (copied onto the
 * order when it was placed, so the merchant editing their accounts later
 * can't change it), the reference to quote, and the deadline the app
 * actually enforces — after it, the order is cancelled and the stock released.
 *
 * Nothing here claims the transfer is received: the merchant confirms that
 * by hand once it reaches their bank.
 */
import { useState } from 'react';
import { Check, Copy, Landmark } from 'lucide-react';
import { formatMoney } from '@/lib/storefront/format';
import { TRANSFER_HOLD_HOURS } from '@/lib/storefront/mock/checkout';
import type { TransferAccount } from '@/lib/storefront/checkout/types';

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard blocked — the value is on screen to copy by hand */
        }
      }}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
    </button>
  );
}

function Row({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="break-words text-sm font-semibold tabular-nums">{value}</dd>
      </div>
      {copy && <CopyButton value={value} label={label.toLowerCase()} />}
    </div>
  );
}

export function TransferInstructions({
  accounts,
  total,
  currency,
  reference,
}: {
  accounts: TransferAccount[];
  /** minor units */
  total: number;
  currency: string;
  reference: string;
}) {
  const amount = formatMoney(total, currency);

  return (
    <section aria-labelledby="transfer-heading" className="rounded-2xl border bg-card p-5">
      <h2 id="transfer-heading" className="flex items-center gap-2 font-display text-lg">
        <Landmark className="size-5" aria-hidden />
        Pay by bank transfer
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Transfer exactly <strong className="font-semibold text-foreground">{amount}</strong> within{' '}
        <strong className="font-semibold text-foreground">{TRANSFER_HOLD_HOURS} hours</strong> of placing your order. If
        it hasn’t arrived by then, the order is cancelled and you won’t owe anything.
      </p>

      <dl className="mt-3 divide-y">
        <Row label="Amount" value={amount} copy />
        <Row label="Reference" value={reference} copy />
      </dl>

      {accounts.map((account, index) => (
        <dl key={`${account.accountNumber}-${index}`} className="mt-3 divide-y rounded-xl border px-4">
          {accounts.length > 1 && (
            <p className="py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Option {index + 1}
            </p>
          )}
          <Row label="Bank" value={account.bankName} />
          <Row label="Account name" value={account.accountName} />
          <Row label="Account number" value={account.accountNumber} copy />
        </dl>
      ))}

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Use your order number as the transfer reference so the store can match your payment. You’ll get an email once
        they’ve confirmed it.
      </p>
    </section>
  );
}
