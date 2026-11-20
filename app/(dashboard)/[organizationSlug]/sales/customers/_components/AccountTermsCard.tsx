'use client';

/*
 * Pay on account (ROADMAP 21.5) on a trade buyer's customer page: whether
 * they have credit, on what terms, and what they owe — on-account orders and
 * unpaid invoices together — with the statement to send them.
 *
 * Off for every buyer until the merchant gives it. Taking it away stops new
 * orders on account; what's owed stays owed.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SwitchRoot } from '@/components/ui/switch';
import { Field, FieldDescription } from '@/components/ui/form-field';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { saveAccountTerms } from '@/features/sales/trade';
import { formatMoney } from '@/lib/format';

export interface AccountTermsCardData {
  onAccount: boolean;
  /** their own days, or null for the shop's default */
  days: number | null;
  defaultDays: number;
  creditLimit: number | null;
  /** naira */
  owed: number;
  overdue: number;
  openItems: number;
}

export function AccountTermsCard({
  customerId,
  approved,
  data,
  canManage,
}: {
  customerId: string;
  approved: boolean;
  data: AccountTermsCardData;
  canManage: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  // Nothing to say: never given credit and owes nothing.
  if (!approved && !data.onAccount && data.owed === 0) return null;
  const days = data.days ?? data.defaultDays;

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Wallet className="size-3.5 text-muted-foreground" aria-hidden />
          Pay on account
        </h2>
        <Badge variant={data.onAccount ? 'success' : 'draft'}>{data.onAccount ? 'On' : 'Off'}</Badge>
      </div>

      <p className="text-xs text-muted-foreground">
        {data.onAccount
          ? `They can order now and pay you within ${days} days${data.days === null ? ' (your default)' : ''}${
              data.creditLimit !== null ? `, owing up to ${formatMoney(data.creditLimit)} at once` : ', with no limit'
            }. Nothing overdue is allowed before a new order.`
          : 'Off: they pay at checkout or on delivery, as you allow for wholesale orders. Give credit only to buyers you trust.'}
      </p>

      <dl className="grid grid-cols-2 gap-2">
        <div>
          <dt className="text-xs text-muted-foreground">Owes you</dt>
          <dd className="font-medium tabular-nums">{formatMoney(data.owed)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Overdue</dt>
          <dd className={`tabular-nums ${data.overdue > 0 ? 'font-medium text-destructive' : ''}`}>{formatMoney(data.overdue)}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        {canManage && approved && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {data.onAccount ? 'Change terms' : 'Give credit'}
          </Button>
        )}
        {data.openItems > 0 && (
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/sales/customers/${customerId}/statement`}>Statement</Link>
          </Button>
        )}
      </div>

      {open && <TermsDialog customerId={customerId} data={data} onClose={() => setOpen(false)} />}
    </section>
  );
}

function TermsDialog({ customerId, data, onClose }: { customerId: string; data: AccountTermsCardData; onClose: () => void }) {
  const router = useRouter();
  // Opened to give credit or to change it, so it starts switched on.
  const [onAccount, setOnAccount] = React.useState(true);
  const [days, setDays] = React.useState(data.days !== null ? String(data.days) : '');
  const [limit, setLimit] = React.useState(data.creditLimit !== null ? String(data.creditLimit) : '');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const dayValue = days.trim() === '' ? null : Number(days);
    const limitValue = limit.trim() === '' ? null : Number(limit.replace(/,/g, ''));
    if (dayValue !== null && (!Number.isInteger(dayValue) || dayValue < 1)) {
      setError('Enter a whole number of days, or leave it blank for your default.');
      return;
    }
    if (limitValue !== null && (!Number.isFinite(limitValue) || limitValue <= 0)) {
      setError('Enter an amount, or leave it blank for no limit.');
      return;
    }
    setPending(true);
    setError(null);
    const result = await saveAccountTerms(customerId, { onAccount, days: dayValue, creditLimit: limitValue });
    setPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success(onAccount ? 'Account terms saved' : 'Pay on account turned off');
    onClose();
    router.refresh();
  }

  return (
    <DialogRoot open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Pay on account</DialogTitle>
            <DialogDescription>
              Let this buyer order now and pay you later. Their orders are confirmed straight away and go out like paid ones.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            {error && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div>
                <Label htmlFor="terms-on">Allow pay on account</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">Turning it off stops new orders on account. What they owe stays owed.</p>
              </div>
              <SwitchRoot id="terms-on" checked={onAccount} onCheckedChange={setOnAccount} />
            </div>
            {onAccount && (
              <>
                <Field>
                  <Label htmlFor="terms-days">Days to pay</Label>
                  <Input
                    id="terms-days"
                    inputMode="numeric"
                    placeholder={`${data.defaultDays} (your default)`}
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                  />
                  <FieldDescription>From the day they order. Leave blank to use your default, set in Settings → Wholesale.</FieldDescription>
                </Field>
                <Field>
                  <Label htmlFor="terms-limit">Credit limit (₦)</Label>
                  <Input
                    id="terms-limit"
                    inputMode="decimal"
                    placeholder="No limit"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                  />
                  <FieldDescription>The most they may owe you at once, invoices included. Leave blank for no limit.</FieldDescription>
                </Field>
              </>
            )}
          </div>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Save terms
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
