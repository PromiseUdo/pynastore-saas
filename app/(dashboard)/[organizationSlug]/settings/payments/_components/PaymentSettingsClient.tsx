'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Banknote, CircleCheck, CreditCard, Landmark, Loader2, MoreHorizontal, Pencil, Plus, RotateCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SwitchRoot } from '@/components/ui/switch';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { Table, TableWrapper, TableHead, TableBody, TableRow, TableColumnHeader, TableCell } from '@/components/ui/table';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  deleteBankAccount,
  lookupBankAccountName,
  saveBankAccount,
  setBankAccountActive,
  type BankAccountFieldErrors,
  type BankAccountRow,
} from '@/features/settings/bank-accounts';
import { NIGERIAN_BANKS, bankByName } from '@/lib/payments/nigerian-banks';

export function PaymentSettingsClient({
  accounts,
  canManage,
  transferHoldHours,
}: {
  accounts: BankAccountRow[];
  canManage: boolean;
  transferHoldHours: number;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<BankAccountRow | null>(null);
  const [deleting, setDeleting] = React.useState<BankAccountRow | null>(null);
  const [pending, setPending] = React.useState(false);

  const activeCount = accounts.filter((a) => a.isActive).length;

  function open(account: BankAccountRow | null) {
    setEditing(account);
    setDialogOpen(true);
  }

  async function toggle(account: BankAccountRow, isActive: boolean) {
    const result = await setBankAccountActive(account.id, isActive);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(isActive ? 'Shown at checkout' : 'Hidden from checkout');
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setPending(true);
    const result = await deleteBankAccount(deleting.id);
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Bank account removed');
    setDeleting(null);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Payments"
        description="How customers can pay on your online store."
        actions={
          canManage && accounts.length > 0 ? (
            <Button size="sm" onClick={() => open(null)}>
              <Plus className="size-3.5" />
              Add bank account
            </Button>
          ) : undefined
        }
      />

      <PageBody>
        <section className="rounded-lg border bg-card">
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Payment options at checkout</h2>
          <ul className="divide-y text-sm">
            <li className="flex items-start gap-3 px-4 py-3">
              <CreditCard className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Pay online</p>
                <p className="text-xs text-muted-foreground">
                  Card or bank transfer through Squad. Orders are marked paid automatically.
                </p>
              </div>
              <Badge variant="success">On</Badge>
            </li>
            <li className="flex items-start gap-3 px-4 py-3">
              <Banknote className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Pay on delivery</p>
                <p className="text-xs text-muted-foreground">
                  The customer pays the courier. You record the payment when you mark the order delivered.
                </p>
              </div>
              <Badge variant="success">On</Badge>
            </li>
            <li className="flex items-start gap-3 px-4 py-3">
              <Landmark className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Bank transfer to you</p>
                <p className="text-xs text-muted-foreground">
                  The customer transfers the total to one of your accounts below. You confirm each transfer on the order
                  once it reaches your bank; unconfirmed orders are cancelled after {transferHoldHours} hours.
                </p>
              </div>
              <Badge variant={activeCount > 0 ? 'success' : 'draft'}>
                {activeCount > 0 ? 'On' : 'Off — add an account'}
              </Badge>
            </li>
          </ul>
        </section>

        <h2 className="mt-6 text-sm font-semibold">Bank accounts</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Shown to customers who choose bank transfer. Orders keep the details they were placed with, so changing an
          account here doesn’t affect transfers already in progress.
        </p>

        <div className="mt-3">
          {accounts.length === 0 ? (
            <div className="mx-auto flex max-w-lg flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Landmark className="size-5" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-foreground">No bank accounts yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Add an account and customers can pay you by bank transfer at checkout.
              </p>
              {canManage ? (
                <Button size="sm" className="mt-4" onClick={() => open(null)}>
                  <Plus className="size-3.5" />
                  Add bank account
                </Button>
              ) : (
                <p className="mt-4 text-xs text-muted-foreground">Ask an admin to add one.</p>
              )}
            </div>
          ) : (
            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableColumnHeader>Bank</TableColumnHeader>
                    <TableColumnHeader>Account</TableColumnHeader>
                    <TableColumnHeader>Shown at checkout</TableColumnHeader>
                    <TableColumnHeader>
                      <span className="sr-only">Actions</span>
                    </TableColumnHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {accounts.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell className="font-medium text-foreground">{account.bankName}</TableCell>
                      <TableCell>
                        <span className="block tabular-nums text-foreground">{account.accountNumber}</span>
                        <span className="text-xs text-muted-foreground">{account.accountName}</span>
                      </TableCell>
                      <TableCell>
                        <SwitchRoot
                          checked={account.isActive}
                          disabled={!canManage}
                          onCheckedChange={(checked) => void toggle(account, checked)}
                          aria-label={`Show ${account.bankName} ${account.accountNumber} at checkout`}
                        />
                      </TableCell>
                      <TableCell align="right">
                        {canManage && (
                          <DropdownMenuRoot>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Actions for ${account.bankName} ${account.accountNumber}`}
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem onSelect={() => open(account)}>
                                <Pencil />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => setDeleting(account)}
                              >
                                <Trash2 />
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenuRoot>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </div>
      </PageBody>

      {canManage && (
        <>
          <BankAccountDialog
            key={editing?.id ?? 'new'}
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            editing={editing}
            onSaved={() => {
              setDialogOpen(false);
              router.refresh();
            }}
          />
          <AlertDialogRoot open={deleting !== null} onOpenChange={(next) => !next && setDeleting(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove this bank account?</AlertDialogTitle>
                <AlertDialogDescription>
                  Customers won’t see {deleting?.bankName} {deleting?.accountNumber} at checkout any more.
                  {activeCount === 1 && deleting?.isActive && ' It’s your only active account, so bank transfer will be switched off.'}{' '}
                  Orders already waiting for a transfer keep these details. This can’t be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep account</AlertDialogCancel>
                <Button variant="destructive" onClick={confirmDelete} disabled={pending}>
                  {pending && <Loader2 className="size-3.5 animate-spin" />}
                  Remove account
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialogRoot>
        </>
      )}
    </>
  );
}

type Lookup =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'found'; accountName: string }
  | { state: 'failed'; message: string };

function BankAccountDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: BankAccountRow | null;
  onSaved: () => void;
}) {
  const [bankCode, setBankCode] = React.useState(() => (editing ? bankByName(editing.bankName)?.code ?? '' : ''));
  const [accountNumber, setAccountNumber] = React.useState(editing?.accountNumber ?? '');
  const [isActive, setIsActive] = React.useState(editing?.isActive ?? true);
  const [lookup, setLookup] = React.useState<Lookup>({ state: 'idle' });
  const [attempt, setAttempt] = React.useState(0);
  const [errors, setErrors] = React.useState<BankAccountFieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const digits = accountNumber.replace(/\s+/g, '');
  const ready = bankCode !== '' && /^\d{10}$/.test(digits);

  /* The name is looked up as soon as there's a bank and ten digits — the
   * merchant confirms it rather than types it. */
  React.useEffect(() => {
    if (!open || !ready) {
      setLookup({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setLookup({ state: 'checking' });
    setErrors({});
    setFormError(null);
    void lookupBankAccountName({ bankCode, accountNumber: digits }).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setLookup({ state: 'found', accountName: result.data.accountName });
      } else if ('fieldErrors' in result) {
        setErrors(result.fieldErrors);
        setLookup({ state: 'idle' });
      } else {
        setLookup({ state: 'failed', message: result.error });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, ready, bankCode, digits, attempt]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lookup.state !== 'found') {
      setErrors({
        bankCode: bankCode ? undefined : 'Choose your bank',
        accountNumber: /^\d{10}$/.test(digits) ? undefined : 'Account numbers are 10 digits',
      });
      return;
    }
    setPending(true);
    setErrors({});
    setFormError(null);
    const result = await saveBankAccount(editing?.id ?? null, { bankCode, accountNumber: digits, isActive });
    setPending(false);

    if (!result.success) {
      if ('fieldErrors' in result) setErrors(result.fieldErrors);
      else setFormError(result.error);
      return;
    }
    toast.success(editing ? 'Bank account updated' : 'Bank account added');
    onSaved();
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit bank account' : 'Add bank account'}</DialogTitle>
            <DialogDescription>Customers who choose bank transfer will pay into this account.</DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {formError && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            )}

            <Field>
              <Label htmlFor="bank-code">Bank *</Label>
              <SelectRoot value={bankCode} onValueChange={setBankCode}>
                <SelectTrigger id="bank-code" aria-invalid={errors.bankCode ? true : undefined}>
                  <SelectValue placeholder="Choose your bank" />
                </SelectTrigger>
                <SelectContent>
                  {NIGERIAN_BANKS.map((bank) => (
                    <SelectItem key={bank.code} value={bank.code}>
                      {bank.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </SelectRoot>
              {errors.bankCode && <FieldError>{errors.bankCode}</FieldError>}
              {!errors.bankCode && editing && !bankCode && (
                <FieldDescription>
                  Choose “{editing.bankName}” from the list so we can check the account with your bank.
                </FieldDescription>
              )}
            </Field>

            <Field>
              <Label htmlFor="account-number">Account number *</Label>
              <Input
                id="account-number"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0123456789"
                maxLength={12}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                aria-invalid={errors.accountNumber ? true : undefined}
                aria-describedby="account-lookup"
              />
              {errors.accountNumber ? (
                <FieldError>{errors.accountNumber}</FieldError>
              ) : (
                <FieldDescription>Your 10-digit account number. We’ll look up the name on it for you.</FieldDescription>
              )}
            </Field>

            <div id="account-lookup" aria-live="polite">
              {lookup.state === 'checking' && (
                <p className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Checking with your bank…
                </p>
              )}
              {lookup.state === 'found' && (
                <div className="flex items-start gap-2.5 rounded-md border bg-muted/40 px-3 py-2.5">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Account name</p>
                    <p className="text-sm font-medium text-foreground">{lookup.accountName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Customers see this name before they send money. If it isn’t yours, check the number.
                    </p>
                  </div>
                </div>
              )}
              {lookup.state === 'failed' && (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  <span>{lookup.message}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                    <RotateCw className="size-3.5" />
                    Try again
                  </Button>
                </div>
              )}
            </div>

            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div>
                <Label htmlFor="account-active">Show at checkout</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">Turn off to stop taking transfers into this account.</p>
              </div>
              <SwitchRoot id="account-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending || lookup.state !== 'found'}>
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              {editing ? 'Save changes' : 'Add bank account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
