'use client';

/*
 * "Get your shop ready" (ROADMAP 12.5) — pinned above the dashboard until the
 * shop is set up or the guide is hidden, and always in Settings → Setup
 * guide. Every tick comes from the real records (lib/onboarding/
 * setup-guide.ts); nothing here is ticked by hand. Each step links to the one
 * screen that does it. Someone without the permission for a step sees who
 * can do it instead of a link.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ExternalLink, Loader2, Store } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogRoot,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import type { SetupProgress, SetupStep, SetupStepKey } from '@/lib/onboarding/setup-steps';
import { closeStorefront, openStorefront, setSetupGuideHidden } from '@/features/onboarding/actions';

export function SetupGuide({
  progress,
  allowed,
  storefrontUrl,
  variant,
}: {
  progress: SetupProgress;
  /** whether the viewer may do each step */
  allowed: Record<SetupStepKey, boolean>;
  storefrontUrl: string;
  variant: 'dashboard' | 'settings';
}) {
  const router = useRouter();
  const [confirm, setConfirm] = React.useState<'open' | 'close' | null>(null);
  const [pending, setPending] = React.useState<'open' | 'close' | 'hide' | null>(null);

  const main = progress.steps.filter((s) => !s.optional);
  const extras = progress.steps.filter((s) => s.optional);
  const doneCount = main.filter((s) => s.done).length;

  async function run(kind: 'open' | 'close' | 'hide') {
    setPending(kind);
    const result = kind === 'open' ? await openStorefront() : kind === 'close' ? await closeStorefront() : await setSetupGuideHidden(true);
    setPending(null);
    setConfirm(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(
      kind === 'open'
        ? 'Your shop is open — customers can order now'
        : kind === 'close'
          ? 'Your shop is closed. Open it again any time from here.'
          : 'Guide hidden. It’s always in Settings → Setup guide.',
    );
    router.refresh();
  }

  return (
    <section aria-labelledby="setup-guide-title" className="rounded-lg border bg-card shadow-xs">
      <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="setup-guide-title" className="text-sm font-semibold text-foreground">
              Get your shop ready
            </h2>
            <Badge variant={progress.isOpen ? 'success' : 'muted'}>{progress.isOpen ? 'Open' : 'Not open yet'}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {progress.isOpen
              ? 'Customers can browse and order from your shop.'
              : progress.readyToOpen
                ? 'Everything needed is done — you can open your shop.'
                : `${progress.requiredTotal - progress.requiredDone} required step${progress.requiredTotal - progress.requiredDone === 1 ? '' : 's'} left before customers can order. Until then they see “Opening soon”.`}
          </p>
          <div className="mt-2 flex items-center gap-2" aria-hidden>
            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / main.length) * 100}%` }} />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {doneCount} of {main.length}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <a href={storefrontUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {progress.isOpen ? 'View shop' : 'Preview shop'}
            <ExternalLink className="size-3" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          {variant === 'dashboard' && allowed.open && (
            <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => run('hide')}>
              {pending === 'hide' && <Loader2 className="size-3.5 animate-spin" />}
              Hide guide
            </Button>
          )}
        </div>
      </div>

      <ol className="divide-y">
        {main.map((step, i) => (
          <StepRow
            key={step.key}
            step={step}
            number={i + 1}
            allowed={allowed[step.key]}
            action={
              step.key === 'open' ? (
                progress.isOpen ? (
                  variant === 'settings' && allowed.open ? (
                    <Button variant="outline" size="sm" onClick={() => setConfirm('close')}>
                      Close shop
                    </Button>
                  ) : null
                ) : (
                  <Button size="sm" disabled={!progress.readyToOpen} onClick={() => setConfirm('open')}>
                    <Store className="size-3.5" aria-hidden />
                    Open your shop
                  </Button>
                )
              ) : undefined
            }
            note={step.key === 'open' && !progress.isOpen && !progress.readyToOpen ? 'Finish the required steps first.' : undefined}
          />
        ))}
      </ol>

      {extras.length > 0 && (
        <div className="border-t">
          <p className="px-5 pt-3 text-xs font-medium text-muted-foreground">Optional</p>
          <ol className="divide-y">
            {extras.map((step) => (
              <StepRow key={step.key} step={step} allowed={allowed[step.key]} />
            ))}
          </ol>
        </div>
      )}

      <AlertDialogRoot open={confirm === 'open'} onOpenChange={(o) => !pending && setConfirm(o ? 'open' : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open your shop?</AlertDialogTitle>
            <AlertDialogDescription>
              Customers will be able to browse your products, check out and pay, and search engines can list your shop.
              You can close it again at any time from Settings → Setup guide.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-xs text-muted-foreground">
            Want to look first?{' '}
            <a href={storefrontUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Preview your shop
            </a>{' '}
            — only your team can see it until it’s open.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending !== null}>Not yet</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending !== null}
              onClick={(e) => {
                e.preventDefault();
                void run('open');
              }}
            >
              {pending === 'open' && <Loader2 className="size-3.5 animate-spin" />}
              Open your shop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>

      <AlertDialogRoot open={confirm === 'close'} onOpenChange={(o) => !pending && setConfirm(o ? 'close' : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close your shop?</AlertDialogTitle>
            <AlertDialogDescription>
              Customers will see “closed for now” and won’t be able to order until you open it again. Orders already
              placed aren’t affected, and nothing is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending !== null}>Keep it open</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              disabled={pending !== null}
              onClick={(e) => {
                e.preventDefault();
                void run('close');
              }}
            >
              {pending === 'close' && <Loader2 className="size-3.5 animate-spin" />}
              Close shop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </section>
  );
}

function StepRow({
  step,
  number,
  allowed,
  action,
  note,
}: {
  step: SetupStep;
  number?: number;
  allowed: boolean;
  /** replaces the link, e.g. the Open button */
  action?: React.ReactNode;
  note?: string;
}) {
  return (
    <li className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
            step.done ? 'bg-emerald-600 text-white dark:bg-emerald-500' : 'border text-muted-foreground',
          )}
          aria-hidden
        >
          {step.done ? <Check className="size-3" strokeWidth={3} /> : (number ?? '·')}
        </span>
        <div className="min-w-0">
          <p className={cn('text-sm', step.done ? 'text-muted-foreground line-through decoration-muted-foreground/40' : 'font-medium text-foreground')}>
            {step.title}
            <span className="sr-only">{step.done ? ' — done' : step.required ? ' — required' : ''}</span>
          </p>
          {!step.done && <p className="text-xs text-muted-foreground">{step.why}</p>}
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
      </div>
      {!step.done && (
        <div className="shrink-0 pl-8 sm:pl-0">
          {action !== undefined ? (
            allowed ? action : <span className="text-xs text-muted-foreground">An owner or admin can do this</span>
          ) : allowed ? (
            <div className="flex flex-wrap gap-2">
              {step.secondary && (
                <Link href={step.secondary.href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  {step.secondary.label}
                </Link>
              )}
              <Link href={step.href} className={buttonVariants({ variant: step.required ? 'default' : 'outline', size: 'sm' })}>
                {step.action}
              </Link>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">An owner or admin can do this</span>
          )}
        </div>
      )}
      {step.done && action ? <div className="shrink-0 pl-8 sm:pl-0">{allowed ? action : null}</div> : null}
    </li>
  );
}
