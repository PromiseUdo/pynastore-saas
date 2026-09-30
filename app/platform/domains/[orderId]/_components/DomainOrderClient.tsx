'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CheckboxRoot } from '@/components/ui/checkbox';
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
import { formatDate, formatMoney, formatRelativeTime } from '@/lib/format';
import { PROMISE_HOURS, STEPS_FOR, STEP_INFO, type DomainStep } from '@/lib/domains/rules';
import {
  checkOrderDns,
  markDomainFailed,
  markDomainLive,
  recordDomainRefund,
  setDomainStep,
  type DomainOrderDetail,
} from '@/features/platform/domains';
import { ORDER_KIND_LABEL, ORDER_STATUS } from '../../labels';

export function DomainOrderClient({ order }: { order: DomainOrderDetail }) {
  const router = useRouter();
  const now = new Date();
  const open = order.status === 'PENDING_FULFILLMENT';
  const steps = STEPS_FOR[order.type];
  const allDone = steps.every((s) => order.steps[s]);
  const due = new Date(new Date(order.readyAt).getTime() + PROMISE_HOURS * 3600_000);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [expiry, setExpiry] = React.useState(order.expiresAt ? new Date(order.expiresAt).toISOString().slice(0, 10) : '');
  const [dialog, setDialog] = React.useState<'live' | 'failed' | 'refund' | null>(null);
  const [reason, setReason] = React.useState('');
  const [refund, setRefund] = React.useState({ amount: order.paid ? String(order.paid.amount) : '', reference: '' });
  const [dns, setDns] = React.useState<null | { ok: boolean; apex: { ok: boolean; found: string[] }; www: { ok: boolean; found: string[] } }>(null);

  async function tick(step: DomainStep, done: boolean) {
    setBusy(step);
    const r = await setDomainStep(order.id, step, done, step === 'registered' ? expiry : undefined);
    setBusy(null);
    if (!r.success) return toast.error(r.error);
    router.refresh();
  }

  async function run(kind: 'live' | 'failed' | 'refund') {
    setBusy(kind);
    const r =
      kind === 'live'
        ? await markDomainLive(order.id)
        : kind === 'failed'
          ? await markDomainFailed(order.id, reason)
          : await recordDomainRefund(order.id, { amount: Number(refund.amount), reference: refund.reference });
    setBusy(null);
    if (!r.success) return toast.error(r.error);
    setDialog(null);
    toast.success(kind === 'live' ? 'Done — the merchant has been emailed' : kind === 'failed' ? 'Marked failed — the merchant has been emailed' : 'Refund recorded');
    router.refresh();
  }

  const copy = (v: string) => void navigator.clipboard?.writeText(v).then(() => toast.success('Copied'));

  return (
    <div>
      <div className="border-b bg-background px-4 py-4 sm:px-6">
        <Link href="/platform/domains" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" aria-hidden /> Domains
        </Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{order.domain}</h1>
            <Badge variant="info">{ORDER_KIND_LABEL[order.type]}</Badge>
            <Badge variant={ORDER_STATUS[order.status]?.variant ?? 'draft'}>{ORDER_STATUS[order.status]?.label ?? '—'}</Badge>
          </div>
          {open && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialog('failed')}>
                Mark failed
              </Button>
              <Button size="sm" disabled={!allDone} onClick={() => setDialog('live')}>
                {order.type === 'RENEW' ? 'Mark renewed' : 'Mark live'}
              </Button>
            </div>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          For{' '}
          <Link href={`/platform/merchants/${order.organization.id}`} className="text-primary hover:underline">
            {order.organization.name}
          </Link>
          {open
            ? ` · due ${formatDate(due)} (${due < now ? `${formatRelativeTime(due, now)} — overdue` : formatRelativeTime(due, now)})`
            : order.fulfilledAt
              ? ` · done ${formatDate(order.fulfilledAt)}`
              : ''}
        </p>
      </div>

      <div className="grid gap-6 px-4 py-6 sm:px-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Checklist" description={open ? 'Tick each step as you finish it. The merchant’s page follows along.' : undefined}>
            <ol className="space-y-3">
              {steps.map((step) => {
                const at = order.steps[step];
                return (
                  <li key={step} className="flex items-start gap-3">
                    <CheckboxRoot
                      checked={Boolean(at)}
                      disabled={!open || busy !== null}
                      onCheckedChange={(v) => tick(step, v === true)}
                      aria-label={STEP_INFO[order.type][step]}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className={at ? 'text-muted-foreground' : 'text-foreground'}>{STEP_INFO[order.type][step]}</p>
                      {at && <p className="text-xs text-muted-foreground">Done {formatRelativeTime(at, now)}</p>}
                      {step === 'registered' && (
                        <div className="mt-2 flex items-center gap-2">
                          <Label htmlFor="expiry" className="text-xs">
                            Expiry date at Namecheap
                          </Label>
                          <Input id="expiry" type="date" value={expiry} disabled={!open || Boolean(at)} onChange={(e) => setExpiry(e.target.value)} className="h-8 w-44" />
                        </div>
                      )}
                      {step === 'dns' && open && (
                        <div className="mt-2 space-y-1">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== null}
                            onClick={async () => {
                              setBusy('check');
                              const r = await checkOrderDns(order.id);
                              setBusy(null);
                              if (!r.success) return toast.error(r.error);
                              setDns(r.data);
                            }}
                          >
                            {busy === 'check' && <Loader2 className="size-3.5 animate-spin" />}
                            Check DNS now
                          </Button>
                          {dns && (
                            <p className="text-xs text-muted-foreground">
                              Domain: {dns.apex.ok ? 'correct' : `points to ${dns.apex.found.join(', ') || 'nothing'}`} · www:{' '}
                              {dns.www.ok ? 'correct' : `points to ${dns.www.found.join(', ') || 'nothing'}`}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Section>

          {order.type !== 'RENEW' && (
            <Section title="DNS records" description={`Both ${order.domain} and ${order.canonicalHost} must point here. ${order.canonicalHost} is the address shoppers use.`}>
              <ul className="space-y-1 font-mono text-xs">
                {order.dnsRecords.map((r) => (
                  <li key={r.type} className="flex items-center gap-2">
                    <span className="w-14">{r.type}</span>
                    <span className="w-10">{r.name}</span>
                    <span className="flex-1">{r.value}</span>
                    <Button variant="ghost" size="sm" aria-label={`Copy ${r.type} value`} onClick={() => copy(r.value)}>
                      <Copy className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {order.status === 'FAILED' && (
            <Section title="Failed" description={order.failureReason ?? undefined}>
              {order.paid ? (
                order.refund ? (
                  <p className="flex items-center gap-2 text-sm text-foreground">
                    <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    Refunded {formatMoney(order.refund.amount)} on {formatDate(order.refund.at)} ({order.refund.reference})
                  </p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <p className="text-foreground">
                      Refund {formatMoney(order.paid.amount)} in Paystack’s dashboard (transaction {order.paid.reference}), then record it here.
                    </p>
                    <Button size="sm" onClick={() => setDialog('refund')}>
                      Record refund
                    </Button>
                  </div>
                )
              ) : (
                <p className="text-sm text-muted-foreground">Nothing was paid, so there’s nothing to refund.</p>
              )}
            </Section>
          )}
        </div>

        <div className="space-y-6">
          <Section title="Registrant" description={order.type === 'REGISTER' ? 'Register it in the merchant’s name — they own it.' : undefined}>
            <dl className="space-y-1.5 text-sm">
              <Fact label="Business" value={order.registrant.businessName} />
              <Fact label="Contact" value={order.registrant.name} />
              <Fact label="Email" value={order.registrant.email} />
              <Fact label="Phone" value={order.registrant.phone} />
            </dl>
          </Section>
          <Section title="Payment">
            <dl className="space-y-1.5 text-sm">
              <Fact label="Paid" value={order.paid ? formatMoney(order.paid.amount) : order.type === 'EXISTING' ? 'Free (their own domain)' : 'Not paid'} />
              <Fact label="Reference" value={order.paid?.reference ?? null} />
              {order.currentExpiry && <Fact label="Current expiry" value={formatDate(order.currentExpiry)} />}
            </dl>
          </Section>
        </div>
      </div>

      <AlertDialogRoot open={dialog === 'live'} onOpenChange={(o) => !busy && setDialog(o ? 'live' : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{order.type === 'RENEW' ? `Mark ${order.domain} renewed?` : `Put ${order.canonicalHost} live?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {order.type === 'RENEW'
                ? 'The new expiry date is saved and the merchant is emailed.'
                : `${order.organization.name}’s shop starts opening at ${order.canonicalHost} within seconds; its old address redirects there. The merchant is emailed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(e) => {
                e.preventDefault();
                void run('live');
              }}
            >
              {busy === 'live' && <Loader2 className="size-3.5 animate-spin" />}
              {order.type === 'RENEW' ? 'Mark renewed' : 'Put it live'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>

      <AlertDialogRoot open={dialog === 'failed'} onOpenChange={(o) => !busy && setDialog(o ? 'failed' : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this failed?</AlertDialogTitle>
            <AlertDialogDescription>
              The merchant is emailed this reason{order.paid ? ', and told their payment is being returned — refund it in Paystack, then record it here' : ''}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="fail-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea id="fail-reason" rows={3} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} placeholder="The name was registered by someone else before we could." />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              disabled={busy !== null}
              onClick={(e) => {
                e.preventDefault();
                void run('failed');
              }}
            >
              {busy === 'failed' && <Loader2 className="size-3.5 animate-spin" />}
              Mark failed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>

      <AlertDialogRoot open={dialog === 'refund'} onOpenChange={(o) => !busy && setDialog(o ? 'refund' : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Record the refund</AlertDialogTitle>
            <AlertDialogDescription>Enter what you refunded in Paystack’s dashboard and its reference.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="refund-amount">Amount</Label>
              <Input id="refund-amount" inputMode="decimal" value={refund.amount} onChange={(e) => setRefund((r) => ({ ...r, amount: e.target.value }))} startAdornment={<span className="text-sm text-muted-foreground">₦</span>} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="refund-ref">Paystack reference</Label>
              <Input id="refund-ref" value={refund.reference} onChange={(e) => setRefund((r) => ({ ...r, reference: e.target.value }))} />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(e) => {
                e.preventDefault();
                void run('refund');
              }}
            >
              {busy === 'refund' && <Loader2 className="size-3.5 animate-spin" />}
              Record refund
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="rounded-lg border bg-card shadow-xs">
      <div className="border-b px-5 py-3.5">
        <h2 id={id} className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value ?? '—'}</dd>
    </div>
  );
}
