'use client';

/*
 * The one submit button the account forms use.
 *
 * Disabled and spinning while the action is in flight — a form that looks
 * inert after a tap gets tapped again, and a second tap on "Create account"
 * is a second account attempt. The label always names the result ("Sign in",
 * "Create account"), never "Submit".
 */
import { Loader2 } from 'lucide-react';

export function SubmitButton({
  children,
  pending,
  pendingLabel,
}: {
  children: React.ReactNode;
  pending: boolean;
  pendingLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand text-base font-semibold text-primary-foreground transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {pending ? pendingLabel : children}
    </button>
  );
}
