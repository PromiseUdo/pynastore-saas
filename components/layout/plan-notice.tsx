/*
 * What the workspace's plan means for the person looking at it, right now
 * (ROADMAP 12.1): a trial counting down, a plan that has ended with the shop
 * still open during grace, or a shop that has closed. Rendered above every
 * dashboard page by app/(dashboard)/layout.tsx. Nothing is shown while a paid
 * plan is running.
 *
 * "Choose a plan" is always one click away for someone who can manage
 * billing; anyone else is told who can.
 */
import Link from 'next/link';
import { AlertTriangle, Clock, Lock } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import { daysUntil, type AccessState } from '@/lib/billing/access';

export interface PlanNoticeProps {
  state: AccessState;
  planName: string;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
  canManageBilling: boolean;
  now?: Date;
}

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

export function PlanNotice({ state, planName, trialEndsAt, graceEndsAt, canManageBilling, now = new Date() }: PlanNoticeProps) {
  if (state === 'active' || state === 'none') return null;

  let tone: 'info' | 'warning' | 'danger';
  let Icon = Clock;
  let text: string;

  if (state === 'trial') {
    const left = trialEndsAt ? daysUntil(trialEndsAt, now) : 0;
    tone = left <= 3 ? 'warning' : 'info';
    text = trialEndsAt
      ? `Your free trial of ${planName} ends in ${days(left)}, on ${formatDate(trialEndsAt)}. Choose a plan to keep everything running.`
      : `You’re on a free trial of ${planName}.`;
  } else if (state === 'grace') {
    tone = 'warning';
    Icon = AlertTriangle;
    text = graceEndsAt
      ? `Your plan has ended. Your shop keeps taking orders for ${days(daysUntil(graceEndsAt, now))}, until ${formatDate(graceEndsAt)} — choose a plan to keep it open.`
      : 'Your plan has ended. Choose a plan to keep your shop open.';
  } else {
    tone = 'danger';
    Icon = Lock;
    text =
      'Your plan has ended, so your shop is closed to customers. You can still finish the orders you already have. Choose a plan to reopen straight away.';
  }

  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-2 border-b px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6',
        tone === 'info' && 'bg-primary/5 text-foreground',
        tone === 'warning' && 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
        tone === 'danger' && 'bg-destructive/10 text-foreground',
      )}
    >
      <p className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{text}</span>
      </p>
      {canManageBilling ? (
        <Link href="/upgrade" className={buttonVariants({ size: 'sm', variant: tone === 'info' ? 'outline' : 'default', className: 'shrink-0 self-start sm:self-auto' })}>
          Choose a plan
        </Link>
      ) : (
        <span className="shrink-0 text-xs opacity-80">Ask the owner to choose a plan.</span>
      )}
    </div>
  );
}

/**
 * Shown instead of a page a lapsed workspace can't open (ROADMAP 12.1). It
 * says what happened and what still works, and never locks the owner out of
 * paying.
 */
export function PlanEndedPage({ canManageBilling }: { canManageBilling: boolean }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-16 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Lock className="size-5" aria-hidden />
      </div>
      <h1 className="mt-3 text-lg font-semibold text-foreground">Your plan has ended</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your shop is closed to customers and this page is unavailable until a plan is chosen. Nothing has been deleted —
        everything reopens the moment you choose one.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        You can still open your orders to send, deliver or refund what customers have already paid for.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {canManageBilling ? (
          <Link href="/upgrade" className={buttonVariants({ size: 'sm' })}>
            Choose a plan
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">Ask the owner to choose a plan.</p>
        )}
        <Link href="/sales/orders" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
          Go to orders
        </Link>
      </div>
    </div>
  );
}

/** The plan as the sidebar and the workspace switcher name it. */
export function planLabel(state: AccessState, planName: string): string {
  if (state === 'trial') return `${planName} · Trial`;
  if (state === 'grace' || state === 'lapsed') return 'Plan ended';
  if (state === 'none') return 'No plan';
  return planName;
}
