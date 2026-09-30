'use client';

import { useActionState } from 'react';
import { CheckCircle2, Loader2, MailWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { confirmEmailAction, type ConfirmState } from './actions';

export function ConfirmEmailForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ConfirmState, FormData>(confirmEmailAction, null);

  if (state?.ok) {
    return (
      <div className="p-8 text-center">
        <CheckCircle2 className="mx-auto size-8 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold text-foreground">Email confirmed</h1>
        <p className="mt-1 text-sm text-muted-foreground">You can create your shop now.</p>
        <a href="/onboarding" className={buttonVariants({ className: 'mt-5 w-full' })}>
          Create your shop
        </a>
      </div>
    );
  }

  if (state && !state.ok) {
    return (
      <div className="p-8 text-center">
        <MailWarning className="mx-auto size-8 text-amber-600 dark:text-amber-400" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold text-foreground">
          {state.reason === 'expired' ? 'This link has expired' : 'This link doesn’t work'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {state.reason === 'expired'
            ? 'Links work for 48 hours. Sign in and we’ll send you a new one.'
            : 'It may have been used already. Sign in — if your email still needs confirming, you can ask for a new link.'}
        </p>
        <a href="/onboarding" className={buttonVariants({ variant: 'outline', className: 'mt-5 w-full' })}>
          Continue
        </a>
      </div>
    );
  }

  return (
    <form action={action} className="p-8 text-center">
      <input type="hidden" name="token" value={token} />
      <h1 className="text-lg font-semibold text-foreground">Confirm your email</h1>
      <p className="mt-1 text-sm text-muted-foreground">Press the button to confirm this is your email address.</p>
      <Button type="submit" className="mt-5 w-full" disabled={pending}>
        {pending && <Loader2 className="size-3.5 animate-spin" />}
        Confirm my email
      </Button>
    </form>
  );
}
