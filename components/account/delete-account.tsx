'use client';

/*
 * "Delete my account" (ROADMAP 19.3) — the person's own staff account, on
 * every surface: Settings → Your account, and onboarding for someone who
 * never made a shop. What goes and what stays is lib/data-rights/staff.ts;
 * this says it in plain words before anyone presses the button.
 */
import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogRoot,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { deleteMyAccount } from '@/features/account/actions';
import { marketingUrlHere } from '@/lib/tenant/urls';

export interface OwnedShop {
  name: string;
  /** where its members are, to make someone else an Owner */
  membersHref: string;
  /** where it can be closed */
  closeHref: string;
}

export function DeleteAccount({
  email,
  confirmWith,
  soleOwnerOf,
}: {
  email: string;
  /** a password account confirms with it; a Google or Apple one types its email */
  confirmWith: 'password' | 'email';
  /** shops that would be left without an Owner: deleting waits until they aren't */
  soleOwnerOf: OwnedShop[];
}) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const blocked = soleOwnerOf.length > 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!value.trim()) return setError(confirmWith === 'password' ? 'Enter your password.' : 'Type your email address.');
    setError(null);
    startTransition(async () => {
      const result = await deleteMyAccount(value);
      if (!result.success) {
        setError(result.error);
        return;
      }
      toast.success('Your account was deleted');
      await signOut({ callbackUrl: marketingUrlHere('/login?deleted=1') });
    });
  }

  return (
    <section className="rounded-lg border border-destructive/30 bg-card p-5 shadow-xs">
      <h2 className="text-sm font-semibold text-foreground">Delete my account</h2>
      <div className="mt-1 space-y-2 text-sm text-muted-foreground">
        <p>
          This deletes <span className="font-medium text-foreground">{email}</span> for good. You’ll be signed out everywhere and can’t sign in
          with it again, and you’ll leave every shop you’re a member of.
        </p>
        <p>
          What you did in a shop — orders you took, changes in its activity — stays with that shop as its records, shown as “Former member”.
          Your name and email are removed from them.
        </p>
      </div>

      {blocked ? (
        <div className="mt-4 rounded-md border bg-muted/40 p-4 text-sm">
          <p className="font-medium text-foreground">First, every shop needs another Owner</p>
          <p className="mt-1 text-muted-foreground">You’re the only Owner of these. Make another member an Owner, or close the shop, then come back.</p>
          <ul className="mt-3 space-y-2">
            {soleOwnerOf.map((shop) => (
              <li key={shop.membersHref} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-foreground">{shop.name}</span>
                <a href={shop.membersHref} className="text-primary hover:underline">
                  Members
                </a>
                <a href={shop.closeHref} className="text-primary hover:underline">
                  Close the shop
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Button variant="destructive" size="sm" className="mt-4" onClick={() => setOpen(true)}>
          Delete my account
        </Button>
      )}

      <AlertDialogRoot
        open={open}
        onOpenChange={(next) => {
          if (pending) return;
          setOpen(next);
          if (!next) {
            setValue('');
            setError(null);
          }
        }}
      >
        <AlertDialogContent>
          <form onSubmit={submit} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                This can’t be undone. You’ll be signed out and leave every shop you’re in. The shops keep their records.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="delete-account-confirm">{confirmWith === 'password' ? 'Your password' : 'Type your email address to confirm'}</Label>
              <Input
                id="delete-account-confirm"
                type={confirmWith === 'password' ? 'password' : 'email'}
                autoComplete={confirmWith === 'password' ? 'current-password' : 'off'}
                placeholder={confirmWith === 'password' ? undefined : email}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'delete-account-error' : undefined}
              />
              {error && (
                <p id="delete-account-error" role="alert" className="text-xs font-medium text-destructive">
                  {error}
                </p>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={pending}>
                Keep my account
              </AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                Delete my account
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialogRoot>
    </section>
  );
}
