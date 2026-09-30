'use client';

import * as React from 'react';
import { Loader2, MailCheck } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/toaster';
import { getMarketingUrl } from '@/lib/tenant/urls';
import { resendVerificationEmail } from './actions';

/** Shown on /onboarding until the owner has confirmed their email (ROADMAP 12.5). */
export function VerifyEmailGate({ email }: { email: string }) {
  const [pending, setPending] = React.useState(false);

  async function resend() {
    setPending(true);
    const result = await resendVerificationEmail();
    setPending(false);
    if (!result.ok) return toast.error(result.error);
    if (result.result === 'already') return window.location.reload();
    toast.success(result.result === 'sent' ? 'Sent — check your inbox' : 'We just sent one — give it a minute to arrive');
  }

  return (
    <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
      <MailCheck className="mx-auto size-8 text-primary" aria-hidden />
      <h1 className="mt-3 text-xl font-semibold tracking-tight">Confirm your email</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We sent a link to <span className="font-medium text-foreground">{email}</span>. Open it to confirm this is your
        address, then come back here to create your shop.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">Can’t find it? Check your spam or promotions folder.</p>
      <div className="mt-6 flex flex-col gap-2">
        <Button onClick={() => window.location.reload()}>I’ve confirmed it</Button>
        <Button variant="outline" onClick={resend} disabled={pending}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Send the link again
        </Button>
        <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: getMarketingUrl('/login') })}>
          Wrong email? Sign out
        </Button>
      </div>
      <Toaster />
    </div>
  );
}
