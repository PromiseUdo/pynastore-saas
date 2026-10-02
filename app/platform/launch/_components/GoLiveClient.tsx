'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, CircleDashed, Copy, Loader2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageBody } from '@/components/layout/page-header';
import { movePayoutsToCurrentMode, type GoLivePage } from '@/features/platform/go-live';
import type { GoLiveCheck } from '@/lib/ops/go-live';

const GROUP_ORDER = ['Payments', 'Email', 'Social', 'Platform', 'Mobile app', 'Legal'] as const;

export function GoLiveClient({ data }: { data: GoLivePage }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const remaining = data.checks.filter((c) => c.status === 'action').length;

  function movePayouts() {
    startTransition(async () => {
      const result = await movePayoutsToCurrentMode();
      if (!result.success) {
        toast.error(result.error);
      } else {
        const { moved, failed, left } = result.data;
        const text = `${moved} set up${failed ? `, ${failed} failed (see Payments → Payouts)` : ''}${left ? ` — ${left} left, press again` : ''}.`;
        if (failed) toast.error(text);
        else toast.success(text);
      }
      router.refresh();
    });
  }

  const copy = (value: string) => void navigator.clipboard?.writeText(value).then(() => toast.success('Copied'));

  return (
    <PageBody>
      <div className="max-w-3xl space-y-8">
        <p className="flex items-start gap-2 rounded-lg border bg-card p-4 text-sm">
          {remaining === 0 ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          ) : (
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          )}
          <span>
            {remaining === 0
              ? 'Every setting this server can check is ready. Confirm the steps at the bottom by hand.'
              : `${remaining} ${remaining === 1 ? 'setting needs' : 'settings need'} attention. Settings change in Vercel → Settings → Environment Variables, then a redeploy.`}
          </span>
        </p>

        {GROUP_ORDER.filter((g) => data.checks.some((c) => c.group === g)).map((group) => (
          <section key={group} aria-labelledby={`g-${group}`} className="space-y-3">
            <h2 id={`g-${group}`} className="text-sm font-semibold text-foreground">
              {group}
            </h2>
            <ul className="divide-y rounded-lg border bg-card">
              {data.checks
                .filter((c) => c.group === group)
                .map((check) => (
                  <CheckRow key={check.id} check={check}>
                    {check.id === 'paystack-webhook' && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <code className="rounded bg-muted px-2 py-1 text-xs text-foreground">{data.webhookUrl}</code>
                        <Button size="sm" variant="ghost" onClick={() => copy(data.webhookUrl)} aria-label="Copy the webhook address">
                          <Copy className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    )}
                    {check.id === 'payouts' && data.payoutsToMove > 0 && (
                      <Button size="sm" className="mt-2" onClick={movePayouts} disabled={pending || data.keyMode === null}>
                        {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                        {pending ? 'Setting up…' : `Set up payout accounts in ${data.keyMode ?? 'this'} mode`}
                      </Button>
                    )}
                  </CheckRow>
                ))}
            </ul>
          </section>
        ))}

        <section aria-labelledby="manual" className="space-y-3">
          <div>
            <h2 id="manual" className="text-sm font-semibold text-foreground">
              Confirm by hand
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              These happen in other companies’ dashboards, so this server can’t see them. docs/GO-LIVE.md walks through each.
            </p>
          </div>
          <ul className="divide-y rounded-lg border bg-card">
            {[...data.manual]
              .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
              .map((step) => (
                <li key={step.id} className="flex items-start gap-3 px-4 py-3">
                  <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {step.title} <span className="font-normal text-muted-foreground">· {step.group}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      </div>
    </PageBody>
  );
}

function CheckRow({ check, children }: { check: GoLiveCheck; children?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      {check.status === 'ok' ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      ) : (
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-foreground">{check.title}</p>
          <Badge variant={check.status === 'ok' ? 'success' : 'warning'}>{check.status === 'ok' ? 'Ready' : 'Needs attention'}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{check.detail}</p>
        {children}
      </div>
    </li>
  );
}
