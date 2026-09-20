'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Banknote, CreditCard, Landmark, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SwitchRoot } from '@/components/ui/switch';
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
  saveBankAccount,
  setBankAccountActive,
  type BankAccountFieldErrors,
  type BankAccountRow,
} from '@/features/settings/bank-accounts';

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
  const [bankName, setBankName] = React.useState(editing?.bankName ?? '');
  const [accountName, setAccountName] = React.useState(editing?.accountName ?? '');
  const [accountNumber, setAccountNumber] = React.useState(editing?.accountNumber ?? '');
  const [isActive, setIsActive] = React.useState(editing?.isActive ?? true);
  const [errors, setErrors] = React.useState<BankAccountFieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    const result = await saveBankAccount(editing?.id ?? null, { bankName, accountName, accountNumber, isActive });
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
              <Label htmlFor="bank-name">Bank *</Label>
              <Input
                id="bank-name"
                autoFocus
                placeholder="e.g. GTBank"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                aria-invalid={errors.bankName ? true : undefined}
              />
              {errors.bankName && <FieldError>{errors.bankName}</FieldError>}
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
              />
              {errors.accountNumber ? (
                <FieldError>{errors.accountNumber}</FieldError>
              ) : (
                <FieldDescription>Your 10-digit account number.</FieldDescription>
              )}
            </Field>

            <Field>
              <Label htmlFor="account-name">Account name *</Label>
              <Input
                id="account-name"
                placeholder="As it appears on the account"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                aria-invalid={errors.accountName ? true : undefined}
              />
              {errors.accountName ? (
                <FieldError>{errors.accountName}</FieldError>
              ) : (
                <FieldDescription>Customers check this name before they send money, so match your bank exactly.</FieldDescription>
              )}
            </Field>

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
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              {editing ? 'Save changes' : 'Add bank account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
