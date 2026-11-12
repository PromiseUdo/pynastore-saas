'use client';

import * as React from 'react';
import { CheckCircle2, Loader2, MailWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { confirmEmailChangeAction, type SecurityResult } from '@/features/account/security';

export function ConfirmNewEmail({ token }: { token: string }) {
  const [result, setResult] = React.useState<SecurityResult<{ email: string }> | null>(null);
  const [pending, setPending] = React.useState(false);

  async function confirm() {
    setPending(true);
    setResult(await confirmEmailChangeAction(token));
    setPending(false);
  }

  if (result?.success) {
    return (
      <div className="p-8 text-center">
        <CheckCircle2 className="mx-auto size-8 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold text-foreground">Email changed</h1>
        <p className="mt-1 text-sm text-muted-foreground">You now sign in with {result.data.email}.</p>
        <a href="/login" className={buttonVariants({ className: 'mt-5 w-full' })}>
          Continue
        </a>
      </div>
    );
  }

  if (result && !result.success) {
    return (
      <div className="p-8 text-center">
        <MailWarning className="mx-auto size-8 text-amber-600 dark:text-amber-400" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold text-foreground">Your email wasn’t changed</h1>
        <p className="mt-1 text-sm text-muted-foreground">{result.error}</p>
        <a href="/login" className={buttonVariants({ variant: 'outline', className: 'mt-5 w-full' })}>
          Continue
        </a>
      </div>
    );
  }

  return (
    <div className="p-8 text-center">
      <h1 className="text-lg font-semibold text-foreground">Confirm your new email</h1>
      <p className="mt-1 text-sm text-muted-foreground">Your account will sign in with this address from now on.</p>
      <Button className="mt-5 w-full" onClick={confirm} disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        Confirm new email
      </Button>
    </div>
  );
}
