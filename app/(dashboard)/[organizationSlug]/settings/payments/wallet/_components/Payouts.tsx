'use client';

/*
 * Withdrawing from the shop wallet to the shop's bank (ROADMAP 20.7): the
 * verified account, "Withdraw" (amount, then the code EduPay emails),
 * auto-withdraw on a schedule, and what has gone so far.
 *
 * Only the shop's Owner gets the buttons; everyone else who can see the wallet
 * sees where things stand. The server decides everything
 * (lib/wallet/payouts.ts) — the account is never sent from here, and "Withdraw"
 * being hidden while auto-withdraw is on is a courtesy over its own refusal.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Landmark, Loader2, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SwitchRoot } from '@/components/ui/switch';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog';
import { SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetRoot, SheetTitle } from '@/components/ui/sheet';
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableColumnHeader, TableHead, TableRow, TableWrapper } from '@/components/ui/table';
import {
  cancelWithdrawalAction,
  confirmBankLinkAction,
  confirmWithdrawalAction,
  saveAutoWithdrawAction,
  startBankLinkAction,
  startWithdrawalAction,
} from '@/features/settings/shop-wallet-payouts';
import { formatDate, formatMoney } from '@/lib/format';
import type { PayoutView, WithdrawalRow } from '@/lib/wallet/payouts';

const STATUS: Record<WithdrawalRow['status'], { label: string; variant: 'pending' | 'processing' | 'success' | 'destructive' | 'cancelled' | 'warning' }> = {
  AWAITING_CODE: { label: 'Waiting for code', variant: 'pending' },
  CONFIRMING: { label: 'Being checked', variant: 'processing' },
  SENT: { label: 'Sent to your bank', variant: 'success' },
  RETURNED: { label: 'Came back to wallet', variant: 'warning' },
  FAILED: { label: 'Didn’t go through', variant: 'destructive' },
  EXPIRED: { label: 'Not completed', variant: 'cancelled' },
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PERSONAL_MONEY_WARNING =
  'This is your own EduPay wallet, so its balance includes any money you added for shopping — not only the shop’s takings.';

function scheduleSentence(auto: NonNullable<PayoutView['auto']>): string {
  const time = auto.time.slice(0, 5);
  const when =
    auto.frequency === 'weekly'
      ? `Every ${DAYS[auto.dayOfWeek ?? 1]}`
      : auto.frequency === 'monthly'
        ? `On day ${auto.dayOfMonth ?? 1} of every month`
        : 'Every day';
  const keep = auto.reserve > 0 ? `, keeping ${formatMoney(auto.reserve)} in the wallet` : '';
  return `${when} at ${time}${keep}. Only when there’s at least ${formatMoney(auto.minAmount)} to send.`;
}

/** The 6-digit code EduPay emailed. */
function CodeField({ id, value, onChange, error, email }: { id: string; value: string; onChange: (v: string) => void; error?: string; email: string | null }) {
  return (
    <Field>
      <Label htmlFor={id}>Code from the email *</Label>
      <Input
        id={id}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoComplete="one-time-code"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        aria-invalid={error ? true : undefined}
        className="w-36 tracking-[0.3em] tabular-nums"
      />
      {error ? <FieldError>{error}</FieldError> : <FieldDescription>EduPay sent a 6-digit code to {email ?? 'your shop wallet’s email'}.</FieldDescription>}
    </Field>
  );
}

function FormError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  );
}

/* ---------------- connecting the account ---------------- */

function ConnectAccountDialog({ view, onClose }: { view: PayoutView; onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = React.useState<'confirm' | 'code'>('confirm');
  const [code, setCode] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<{ form?: string; code?: string }>({});

  async function send() {
    setPending(true);
    setError({});
    const result = await startBankLinkAction();
    setPending(false);
    if (!result.success) return setError({ form: result.error });
    setStep('code');
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError({});
    const result = await confirmBankLinkAction(code);
    setPending(false);
    if (!result.success) return setError(result.field === 'code' ? { code: result.error } : { form: result.error });
    toast.success('Bank account connected');
    onClose();
    router.refresh();
  }

  return (
    <DialogRoot open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect your bank account</DialogTitle>
          <DialogDescription>
            Withdrawals go to {view.account?.bankName} {view.account?.accountNumber}, the account we verified for your shop.
          </DialogDescription>
        </DialogHeader>
        {error.form && <FormError>{error.form}</FormError>}
        {step === 'confirm' ? (
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={pending} onClick={send}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Email me a code
            </Button>
          </DialogFooter>
        ) : (
          <form onSubmit={confirm} noValidate>
            <div className="mt-4">
              <CodeField id="bank-code" value={code} onChange={setCode} error={error.code} email={view.email} />
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                Connect account
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </DialogRoot>
  );
}

/* ---------------- withdrawing ---------------- */

function WithdrawDialog({
  view,
  balance,
  connected,
  waitingAmount,
  onClose,
}: {
  view: PayoutView;
  /** naira; null when EduPay couldn't be asked */
  balance: number | null;
  connected: boolean;
  /** a withdrawal already waiting for its code: go straight to that step */
  waitingAmount: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = React.useState('');
  const [sent, setSent] = React.useState<number | null>(waitingAmount);
  const [code, setCode] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<{ form?: string; amount?: string; code?: string }>({});

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError({});
    const result = await startWithdrawalAction(amount);
    setPending(false);
    if (!result.success) return setError(result.field === 'amount' ? { amount: result.error } : { form: result.error });
    setSent(result.data.amount);
    router.refresh();
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError({});
    const result = await confirmWithdrawalAction(code);
    setPending(false);
    setCode('');
    if (!result.success) {
      setError(result.field === 'code' ? { code: result.error } : { form: result.error });
      router.refresh();
      return;
    }
    if (result.data === 'checking') {
      toast.warning('We couldn’t get a clear answer from EduPay. We’re checking whether it went — don’t withdraw it again.');
    } else {
      toast.success('Withdrawal sent. EduPay is transferring it to your bank.');
    }
    onClose();
    router.refresh();
  }

  async function cancel() {
    setPending(true);
    const result = await cancelWithdrawalAction();
    setPending(false);
    if (!result.success) return setError({ form: result.error });
    toast.success('Withdrawal cancelled. Nothing has moved.');
    onClose();
    router.refresh();
  }

  return (
    <DialogRoot open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{sent === null ? 'Withdraw to your bank' : `Confirm ${formatMoney(sent)} to your bank`}</DialogTitle>
          <DialogDescription>
            To {view.account?.bankName} {view.account?.accountNumber}
            {view.account?.accountName ? ` (${view.account.accountName})` : ''}. EduPay charges nothing for withdrawals right now.
          </DialogDescription>
        </DialogHeader>
        {error.form && <FormError>{error.form}</FormError>}

        {sent === null ? (
          <form onSubmit={start} noValidate>
            <div className="mt-4 space-y-3">
              <Field>
                <Label htmlFor="withdraw-amount">Amount (₦) *</Label>
                <Input
                  id="withdraw-amount"
                  inputMode="numeric"
                  autoFocus
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-invalid={error.amount ? true : undefined}
                  className="w-48 tabular-nums"
                />
                {error.amount ? (
                  <FieldError>{error.amount}</FieldError>
                ) : (
                  <FieldDescription>Whole naira, ₦100 or more.{balance !== null ? ` The wallet has ${formatMoney(balance)}.` : ''}</FieldDescription>
                )}
              </Field>
              {connected && <p className="text-xs text-muted-foreground">{PERSONAL_MONEY_WARNING}</p>}
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                Email me a code
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={confirm} noValidate>
            <div className="mt-4">
              <CodeField id="withdraw-code" value={code} onChange={setCode} error={error.code} email={view.email} />
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={cancel}>
                Cancel withdrawal
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                Withdraw {formatMoney(sent)}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </DialogRoot>
  );
}

/* ---------------- auto-withdraw ---------------- */

function AutoWithdrawSheet({ view, connected, onClose }: { view: PayoutView; connected: boolean; onClose: () => void }) {
  const router = useRouter();
  const auto = view.auto;
  const [enabled, setEnabled] = React.useState(auto?.enabled ?? false);
  const [frequency, setFrequency] = React.useState<'daily' | 'weekly' | 'monthly'>(auto?.frequency ?? 'daily');
  const [time, setTime] = React.useState((auto?.time ?? '06:05:00').slice(0, 5));
  const [dayOfWeek, setDayOfWeek] = React.useState(String(auto?.dayOfWeek ?? 1));
  const [dayOfMonth, setDayOfMonth] = React.useState(String(auto?.dayOfMonth ?? 1));
  const [minAmount, setMinAmount] = React.useState(String(auto?.minAmount ?? 500));
  const [maxAmount, setMaxAmount] = React.useState(auto?.maxAmount ? String(auto.maxAmount) : '');
  const [reserve, setReserve] = React.useState(String(auto?.reserve ?? 0));
  const [notifyOnRun, setNotifyOnRun] = React.useState(auto?.notifyOnRun ?? true);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const whole = (value: string) => Number(value.replace(/[₦,\s]/g, ''));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await saveAutoWithdrawAction({
      enabled,
      frequency,
      time,
      dayOfWeek: frequency === 'weekly' ? Number(dayOfWeek) : null,
      dayOfMonth: frequency === 'monthly' ? Number(dayOfMonth) : null,
      minAmount: whole(minAmount),
      maxAmount: maxAmount.trim() ? whole(maxAmount) : null,
      reserve: reserve.trim() ? whole(reserve) : 0,
      notifyOnRun,
    });
    setPending(false);
    if (!result.success) return setError(result.error);
    toast.success(enabled ? 'Auto-withdraw is on' : 'Auto-withdraw is off');
    onClose();
    router.refresh();
  }

  return (
    <SheetRoot open onOpenChange={(next) => !next && !pending && onClose()}>
      <SheetContent>
        <form onSubmit={save} noValidate className="flex h-full flex-col">
          <SheetHeader>
            <SheetTitle>Auto-withdraw</SheetTitle>
            <SheetDescription>
              EduPay sends what’s in the wallet to {view.account?.bankName ?? 'your bank'} {view.account?.accountNumber} on a schedule. While it’s on, you
              can’t withdraw by hand.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            {error && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div>
                <Label htmlFor="auto-enabled">Withdraw automatically</Label>
                {connected && <p className="mt-0.5 text-xs text-muted-foreground">{PERSONAL_MONEY_WARNING}</p>}
              </div>
              <SwitchRoot id="auto-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <Field>
              <Label htmlFor="auto-frequency">How often *</Label>
              <SelectRoot value={frequency} onValueChange={(v) => setFrequency(v as typeof frequency)}>
                <SelectTrigger id="auto-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Every day</SelectItem>
                  <SelectItem value="weekly">Every week</SelectItem>
                  <SelectItem value="monthly">Every month</SelectItem>
                </SelectContent>
              </SelectRoot>
            </Field>

            {frequency === 'weekly' && (
              <Field>
                <Label htmlFor="auto-day-week">Day of the week *</Label>
                <SelectRoot value={dayOfWeek} onValueChange={setDayOfWeek}>
                  <SelectTrigger id="auto-day-week">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map((day, index) => (
                      <SelectItem key={day} value={String(index)}>
                        {day}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
              </Field>
            )}

            {frequency === 'monthly' && (
              <Field>
                <Label htmlFor="auto-day-month">Day of the month *</Label>
                <Input id="auto-day-month" inputMode="numeric" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} className="w-24 tabular-nums" />
                <FieldDescription>From 1 to 28, so it falls in every month.</FieldDescription>
              </Field>
            )}

            <Field>
              <Label htmlFor="auto-time">Time *</Label>
              <Input id="auto-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-36" />
            </Field>

            <Field>
              <Label htmlFor="auto-min">Least to send (₦) *</Label>
              <Input id="auto-min" inputMode="numeric" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="w-48 tabular-nums" />
              <FieldDescription>If there’s less than this to send, that run is skipped. ₦100 or more.</FieldDescription>
            </Field>

            <Field>
              <Label htmlFor="auto-max">Most to send (₦)</Label>
              <Input id="auto-max" inputMode="numeric" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className="w-48 tabular-nums" />
              <FieldDescription>Leave empty for no limit.</FieldDescription>
            </Field>

            <Field>
              <Label htmlFor="auto-reserve">Keep in the wallet (₦)</Label>
              <Input id="auto-reserve" inputMode="numeric" value={reserve} onChange={(e) => setReserve(e.target.value)} className="w-48 tabular-nums" />
              <FieldDescription>Never withdrawn. Refunds to customers’ wallets are paid from what’s left here.</FieldDescription>
            </Field>

            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <Label htmlFor="auto-notify">Tell me each time it runs</Label>
              <SwitchRoot id="auto-notify" checked={notifyOnRun} onCheckedChange={setNotifyOnRun} />
            </div>
          </div>

          <SheetFooter>
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Save auto-withdraw
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </SheetRoot>
  );
}

/* ---------------- the section ---------------- */

export function Payouts({
  view,
  isOwner,
  strongSignIn,
  balance,
  connected,
}: {
  view: PayoutView;
  /** only the shop's Owner may withdraw or change auto-withdraw */
  isOwner: boolean;
  /** signed in with two steps (ROADMAP 14.5) — needed for anything that moves money */
  strongSignIn: boolean;
  /** naira; null when EduPay couldn't be asked */
  balance: number | null;
  /** the Owner's own EduPay wallet, shared with their shopping (20.4) */
  connected: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<'connect' | 'withdraw' | 'auto' | null>(null);
  const autoOn = Boolean(view.auto?.enabled);
  const waiting = view.open?.status === 'AWAITING_CODE' ? view.open : null;
  const checking = view.open?.status === 'CONFIRMING' ? view.open : null;
  const close = () => setDialog(null);

  return (
    <section aria-labelledby="payouts-title" className="space-y-4">
      <h2 id="payouts-title" className="text-sm font-semibold">
        Withdrawals to your bank
      </h2>

      {isOwner && !strongSignIn && (
        <p role="status" className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          Withdrawing needs two-step sign-in.{' '}
          <Link href="/settings/account" className="font-medium underline underline-offset-4">
            Turn it on in Your account
          </Link>{' '}
          (it applies straight away), or sign in with Google.
        </p>
      )}

      {!view.reachable && (
        <p role="status" className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          We couldn’t reach EduPay just now, so withdrawals are paused. Refresh this page in a minute.
        </p>
      )}

      {view.autoElsewhere && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Auto-withdraw is paying a different bank account from the one we verified for your shop. Saving auto-withdraw here puts it back on the verified account.
        </p>
      )}

      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <Landmark className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              {view.account ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">
                      {view.account.bankName} <span className="tabular-nums">{view.account.accountNumber}</span>
                    </h3>
                    <Badge variant={view.linked ? 'success' : 'draft'}>{view.linked ? 'Connected' : 'Not connected'}</Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {view.account.accountName ? `${view.account.accountName}. ` : ''}
                    The account we verified for your shop, and the only one withdrawals can go to.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-sm font-semibold">No verified bank account</h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">Withdrawals go to the account in your online payments application, once it’s verified.</p>
                </>
              )}
              {!isOwner && <p className="mt-1 text-xs text-muted-foreground">Only the shop’s owner can withdraw.</p>}
            </div>
          </div>
          {isOwner && strongSignIn && view.reachable && view.account && (
            <div className="flex shrink-0 flex-wrap gap-2 self-start">
              {!view.linked && (
                <Button size="sm" onClick={() => setDialog('connect')}>
                  Connect account
                </Button>
              )}
              {view.linked && !autoOn && !checking && (
                <Button size="sm" onClick={() => setDialog('withdraw')}>
                  {waiting ? 'Enter code' : 'Withdraw'}
                </Button>
              )}
            </div>
          )}
        </div>

        {autoOn && view.linked && (
          <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">Auto-withdraw is on, so withdrawals happen on its schedule. Turn it off to withdraw now.</p>
        )}
        {waiting && (
          <p role="status" className="mt-3 border-t pt-3 text-sm">
            A withdrawal of <span className="tabular-nums">{formatMoney(waiting.amount)}</span> is waiting for the code EduPay emailed. Nothing has moved yet.
          </p>
        )}
        {checking && (
          <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
            <span>
              We’re checking your withdrawal of <span className="tabular-nums">{formatMoney(checking.amount)}</span> with EduPay. Please don’t withdraw it again.
            </span>
            <Button size="sm" variant="outline" onClick={() => router.refresh()}>
              Check again
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">Auto-withdraw</h3>
              {view.auto ? <Badge variant={autoOn ? 'success' : 'draft'}>{autoOn ? 'On' : 'Off'}</Badge> : <Badge variant="warning">Unknown</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {view.auto && autoOn ? scheduleSentence(view.auto) : 'Send what’s in the wallet to your bank on a schedule, instead of withdrawing by hand.'}
            </p>
          </div>
          {isOwner && strongSignIn && view.reachable && view.linked && (
            <Button size="sm" variant="outline" className="shrink-0 self-start" onClick={() => setDialog('auto')}>
              {autoOn ? 'Change' : 'Set up'}
            </Button>
          )}
        </div>
      </div>

      {view.recent.length > 0 && (
        <TableWrapper>
          <Table>
            <TableHead>
              <TableRow>
                <TableColumnHeader>Date</TableColumnHeader>
                <TableColumnHeader>To</TableColumnHeader>
                <TableColumnHeader>Status</TableColumnHeader>
                <TableColumnHeader className="text-right">Amount</TableColumnHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {view.recent.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{formatDate(row.createdAt)}</TableCell>
                  <TableCell>
                    {row.bankName} <span className="tabular-nums">{row.accountNumber}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS[row.status].variant}>{STATUS[row.status].label}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(row.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrapper>
      )}

      {view.runs && view.runs.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Auto-withdraw runs</h3>
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Date</TableColumnHeader>
                  <TableColumnHeader>Result</TableColumnHeader>
                  <TableColumnHeader className="text-right">Amount</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {view.runs.map((run, index) => (
                  <TableRow key={`${run.at ?? 'run'}-${index}`}>
                    <TableCell>{formatDate(run.at)}</TableCell>
                    <TableCell>
                      <Badge variant={run.status === 'success' ? 'success' : run.status === 'failed' ? 'destructive' : 'draft'}>
                        {run.status === 'success' ? 'Sent' : run.status === 'failed' ? 'Failed' : run.status === 'skipped' ? 'Skipped' : 'Unknown'}
                      </Badge>
                      {run.message && <span className="ml-2 text-xs text-muted-foreground">{run.message}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{run.amount === null ? '—' : formatMoney(run.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        </div>
      )}

      {view.recent.length === 0 && !view.runs?.length && <p className="text-sm text-muted-foreground">No withdrawals yet.</p>}

      <p className="text-xs text-muted-foreground">
        “Sent” means EduPay took the money from the wallet and started the bank transfer. If the transfer fails, EduPay puts the money back in the wallet.
      </p>

      {dialog === 'connect' && <ConnectAccountDialog view={view} onClose={close} />}
      {dialog === 'withdraw' && <WithdrawDialog view={view} balance={balance} connected={connected} waitingAmount={waiting?.amount ?? null} onClose={close} />}
      {dialog === 'auto' && <AutoWithdrawSheet view={view} connected={connected} onClose={close} />}
    </section>
  );
}
