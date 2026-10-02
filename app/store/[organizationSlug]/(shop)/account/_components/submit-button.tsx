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
import { cn } from '@/lib/utils';

export function SubmitButton({
  children,
  pending,
  pendingLabel,
  variant = 'primary',
}: {
  children: React.ReactNode;
  pending: boolean;
  pendingLabel: string;
  /** `danger` for the one irreversible act: deleting the account */
  variant?: 'primary' | 'danger';
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        'flex h-12 w-full items-center justify-center gap-2 rounded-full text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60',
        variant === 'danger'
          ? 'bg-destructive text-white hover:bg-destructive/90'
          : 'bg-brand text-primary-foreground hover:bg-brand-hover',
      )}
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {pending ? pendingLabel : children}
    </button>
  );
}
