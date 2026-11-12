'use client';

import { signOutHere } from '@/components/account/sign-out';
import * as React from 'react';
import { Loader2, MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/toaster';
import { isEmailConfirmed, resendVerificationEmail } from './actions';

/** Shown on /onboarding until the owner has confirmed their email (ROADMAP 12.5). */
export function VerifyEmailGate({ email }: { email: string }) {
  const [pending, setPending] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [notYet, setNotYet] = React.useState(false);

  /* "I've confirmed it" asks before reloading, so a press before the link
   * was opened says so — instead of reloading into the same screen and
   * looking like nothing happened. */
  async function checkNow() {
    setChecking(true);
    setNotYet(false);
    const confirmed = await isEmailConfirmed().catch(() => false);
    if (confirmed) return window.location.reload();
    setChecking(false);
    setNotYet(true);
  }

  /* Confirming happens elsewhere — in the Mail app, or a browser tab the
   * link opened — so check again whenever this screen comes back into view
   * (a phone app returning to the front counts, ROADMAP 19.2), and move on
   * by ourselves. "I've confirmed it" stays for anyone who looks first. */
  React.useEffect(() => {
    let checking = false;
    const onVisible = async () => {
      if (document.visibilityState !== 'visible' || checking) return;
      checking = true;
      const confirmed = await isEmailConfirmed().catch(() => false);
      checking = false;
      if (confirmed) window.location.reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

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
      {notYet && (
        <p role="alert" className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
          Your email isn’t confirmed yet. Open the link in the email we sent to {email}, then come back — or send the link
          again below.
        </p>
      )}
      <div className="mt-6 flex flex-col gap-2">
        <Button onClick={checkNow} disabled={checking}>
          {checking && <Loader2 className="size-3.5 animate-spin" />}
          I’ve confirmed it
        </Button>
        <Button variant="outline" onClick={resend} disabled={pending}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Send the link again
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void signOutHere()}>
          Wrong email? Sign out
        </Button>
      </div>
      <Toaster />
    </div>
  );
}
