'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, ExternalLink, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { buttonVariants } from '@/components/ui/button-variants';
import { StatCard, StatGrid } from '@/components/dashboard/stat-card';
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
import { Table, TableBody, TableCell, TableColumnHeader, TableHead, TableRow, TableWrapper } from '@/components/ui/table';
import { formatDate, formatMoney, formatNumber, formatRelativeTime } from '@/lib/format';
import { CYCLES, type BillingCycleKey } from '@/lib/billing/plans';
import { restoreOrganization, suspendOrganization, type MerchantDetail } from '@/features/platform/merchants';
import { VERIFICATION_LABEL, VERIFICATION_VARIANT } from '../../../verification/labels';
import { PLAN_STATE_LABEL, PLAN_STATE_VARIANT } from '../../labels';

const TX_STATUS: Record<string, { label: string; variant: 'success' | 'pending' | 'destructive' }> = {
  SUCCESS: { label: 'Paid', variant: 'success' },
  PENDING: { label: 'Not completed', variant: 'pending' },
  FAILED: { label: 'Failed', variant: 'destructive' },
};
const TX_TYPE: Record<string, string> = { CHECKOUT: 'New plan', RENEWAL: 'Renewal' };
const DOMAIN_TYPE: Record<string, string> = { FREE: 'Free web address', EXISTING: 'Connect their own', REGISTER: 'New domain', RENEW: 'Renewal' };
const DOMAIN_STATUS: Record<string, { label: string; variant: 'pending' | 'success' | 'destructive' | 'cancelled' }> = {
  PENDING_FULFILLMENT: { label: 'Waiting to be set up', variant: 'pending' },
  ACTIVE: { label: 'Live', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  CANCELLED: { label: 'Cancelled', variant: 'cancelled' },
};
const MEMBER_STATUS: Record<string, string> = { ACTIVE: 'Active', SUSPENDED: 'Removed', INVITED: 'Invited' };
const cycleLabel = (c: string | null) => (c && Object.hasOwn(CYCLES, c) ? CYCLES[c as BillingCycleKey].label : '—');

export function MerchantDetailClient({
  data,
  storefrontUrl,
  adminUrl,
}: {
  data: MerchantDetail;
  storefrontUrl: string;
  adminUrl: string;
}) {
  const router = useRouter();
  const { organization: org, plan, figures } = data;
  const suspended = org.status === 'SUSPENDED';
  const now = new Date();

  const [dialog, setDialog] = React.useState<'suspend' | 'restore' | null>(null);
  const [reason, setReason] = React.useState('');
  const [reasonError, setReasonError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function suspend() {
    setReasonError(null);
    if (reason.trim().length < 10) {
      setReasonError('Say why in a sentence or two — the merchant will read it.');
      return;
    }
    setPending(true);
    const result = await suspendOrganization(org.id, reason);
    setPending(false);
    if (!result.success) {
      setReasonError(result.error);
      return;
    }
    setDialog(null);
    setReason('');
    toast.success('Suspended — the owners have been emailed');
    router.refresh();
  }

  async function restore() {
    setPending(true);
    const result = await restoreOrganization(org.id);
    setPending(false);
    setDialog(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Restored — the owners have been emailed');
    router.refresh();
  }

  const nextDate =
    plan.state === 'trial' && plan.trialEndsAt
      ? `Trial ends ${formatDate(plan.trialEndsAt)}`
      : (plan.state === 'grace' || plan.state === 'lapsed') && plan.graceEndsAt
        ? `${plan.state === 'grace' ? 'Shop closes' : 'Shop closed'} ${formatDate(plan.graceEndsAt)}`
        : plan.state === 'active' && plan.currentPeriodEnd
          ? `${plan.cancelAtPeriodEnd ? 'Ends' : 'Renews'} ${formatDate(plan.currentPeriodEnd)}`
          : null;

  return (
    <div>
      <div className="border-b bg-background px-4 py-4 sm:px-6">
        <Link href="/platform/merchants" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" aria-hidden /> Merchants
        </Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{org.name}</h1>
            <Badge variant={suspended ? 'destructive' : 'success'}>{suspended ? 'Suspended' : 'Active'}</Badge>
            <Badge variant={PLAN_STATE_VARIANT[plan.state]}>{PLAN_STATE_LABEL[plan.state]}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.verificationStatus !== 'UNVERIFIED' && (
              <Link href={`/platform/verification/${org.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Payment details
              </Link>
            )}
            {suspended ? (
              <Button size="sm" onClick={() => setDialog('restore')}>
                <ShieldCheck className="size-3.5" aria-hidden />
                Restore
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDialog('suspend')}>
                <ShieldAlert className="size-3.5" aria-hidden />
                Suspend
              </Button>
            )}
          </div>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {suspended
            ? 'Suspended — the dashboard is closed and the shop is offline. Restore to reopen both as they were.'
            : 'Active — the owner and team can sign in, and the shop is open if their plan allows.'}
        </p>
      </div>

      <div className="space-y-6 px-4 py-6 sm:px-6">
        {suspended && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-foreground">
              Suspended{org.suspendedAt ? ` ${formatRelativeTime(org.suspendedAt, now)} (${formatDate(org.suspendedAt)})` : ''}
            </p>
            {org.suspensionReason && (
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                <span className="font-medium text-foreground">Reason the merchant sees: </span>
                {org.suspensionReason}
              </p>
            )}
          </div>
        )}

        <section aria-labelledby="facts" className="rounded-lg border bg-card shadow-xs">
          <h2 id="facts" className="border-b px-5 py-3.5 text-sm font-semibold text-foreground">
            Summary
          </h2>
          <dl className="grid gap-x-6 gap-y-4 px-5 py-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Shop">
              <a href={storefrontUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                {org.customStoreDomain ?? org.slug}
                <ExternalLink className="size-3" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
              <span className="block text-xs text-muted-foreground">Dashboard: {adminUrl.replace(/^https?:\/\//, '')}</span>
            </Fact>
            <Fact label="Plan">
              {plan.name ?? 'No plan'}
              {plan.amount !== null && plan.billingCycle && (
                <span className="text-muted-foreground"> · {formatMoney(plan.amount)} {cycleLabel(plan.billingCycle).toLowerCase()}</span>
              )}
              {nextDate && <span className="block text-xs text-muted-foreground">{nextDate}</span>}
            </Fact>
            <Fact label="Online payments">
              <Badge variant={VERIFICATION_VARIANT[data.verificationStatus]}>{VERIFICATION_LABEL[data.verificationStatus]}</Badge>
            </Fact>
            <Fact label="Joined">{formatDate(org.createdAt)}</Fact>
            <Fact label="Customer contact">
              {org.supportEmail || org.supportPhone ? (
                <>
                  {org.supportEmail ?? '—'}
                  {org.supportPhone && <span className="block text-xs text-muted-foreground">{org.supportPhone}</span>}
                </>
              ) : (
                '—'
              )}
            </Fact>
          </dl>
        </section>

        <StatGrid className="lg:grid-cols-5">
          <StatCard title="Stores" value={formatNumber(figures.stores)} />
          <StatCard title="Products" value={formatNumber(figures.products)} />
          <StatCard title="Orders this month" value={formatNumber(figures.ordersThisMonth)} description="Every channel, less cancelled" />
          <StatCard title="Online takings this month" value={formatMoney(figures.takingsThisMonth)} description="Before Paystack’s fee" />
          <StatCard title="Orders, all time" value={formatNumber(figures.ordersAllTime)} />
        </StatGrid>

        <Section
          title="Shop setup"
          description={
            data.setup.isOpen
              ? 'Open to customers.'
              : `Not open yet — ${data.setup.requiredDone} of ${data.setup.requiredTotal} required steps done.`
          }
        >
          <ul className="grid gap-x-6 gap-y-2 px-5 py-4 text-sm sm:grid-cols-2">
            {data.setup.steps.map((st) => (
              <li key={st.title} className="flex items-center gap-2">
                <span
                  className={
                    st.done
                      ? 'flex size-4 items-center justify-center rounded-full bg-emerald-600 text-white dark:bg-emerald-500'
                      : 'size-4 rounded-full border'
                  }
                  aria-hidden
                >
                  {st.done ? <Check className="size-2.5" strokeWidth={3} /> : null}
                </span>
                <span className={st.done ? 'text-muted-foreground' : 'text-foreground'}>
                  {st.title}
                  <span className="sr-only">{st.done ? ' — done' : ' — not done'}</span>
                </span>
                {st.optional && <span className="text-xs text-muted-foreground">(optional)</span>}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Members" description="Everyone with access to this workspace.">
          <TableWrapper flush>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Name</TableColumnHeader>
                  <TableColumnHeader>Role</TableColumnHeader>
                  <TableColumnHeader>Status</TableColumnHeader>
                  <TableColumnHeader>Joined</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <span className="font-medium text-foreground">{m.name ?? m.email}</span>
                      {m.name && <span className="block text-xs text-muted-foreground">{m.email}</span>}
                    </TableCell>
                    <TableCell>{m.role}</TableCell>
                    <TableCell className="text-muted-foreground">{MEMBER_STATUS[m.status] ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(m.joinedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        </Section>

        <Section title="Billing history" description="What this workspace has paid us, newest first.">
          {data.transactions.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <TableWrapper flush>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableColumnHeader>Date</TableColumnHeader>
                    <TableColumnHeader>What</TableColumnHeader>
                    <TableColumnHeader>Plan</TableColumnHeader>
                    <TableColumnHeader align="right">Amount</TableColumnHeader>
                    <TableColumnHeader>Status</TableColumnHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.transactions.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(t.createdAt)}</TableCell>
                      <TableCell>
                        {TX_TYPE[t.type] ?? '—'}
                        <span className="block font-mono text-[11px] text-muted-foreground">{t.reference}</span>
                      </TableCell>
                      <TableCell>
                        {t.planName ?? '—'}
                        {t.billingCycle && <span className="block text-xs text-muted-foreground">{cycleLabel(t.billingCycle)}</span>}
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {formatMoney(t.amount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={TX_STATUS[t.status]?.variant ?? 'pending'}>{TX_STATUS[t.status]?.label ?? '—'}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </Section>

        <Section title="Domain orders" description="Web addresses this workspace has asked for.">
          {data.domainOrders.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">No domain orders.</p>
          ) : (
            <TableWrapper flush>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableColumnHeader>Domain</TableColumnHeader>
                    <TableColumnHeader>Kind</TableColumnHeader>
                    <TableColumnHeader>Status</TableColumnHeader>
                    <TableColumnHeader>Ordered</TableColumnHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.domainOrders.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium text-foreground">{d.domain ?? '—'}</TableCell>
                      <TableCell>{DOMAIN_TYPE[d.type] ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={DOMAIN_STATUS[d.status]?.variant ?? 'pending'}>{DOMAIN_STATUS[d.status]?.label ?? '—'}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(d.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </Section>

        {data.history.length > 0 && (
          <Section title="Suspension history" description="Every suspension and restore, newest first.">
            <ul className="divide-y">
              {data.history.map((h) => (
                <li key={h.id} className="px-5 py-2.5 text-sm">
                  <span className="text-foreground">
                    {h.action === 'platform.organization.suspended' ? 'Suspended' : 'Restored'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {' '}
                    · {h.staffName ?? 'Someone no longer on the team'} · {formatDate(h.createdAt)}
                  </span>
                  {h.reason && <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{h.reason}</p>}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      <AlertDialogRoot
        open={dialog === 'suspend'}
        onOpenChange={(open) => {
          if (pending) return;
          setDialog(open ? 'suspend' : null);
          if (!open) setReasonError(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend {org.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its dashboard closes for every member and its shop goes offline to customers within seconds. Nothing is
              deleted, and restoring reopens both as they were. The owners are emailed this reason.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="suspend-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="suspend-reason"
              rows={4}
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? 'suspend-reason-error' : 'suspend-reason-help'}
            />
            <p id="suspend-reason-help" className="text-xs text-muted-foreground">
              Written to the merchant — say what happened and what they can do about it.
            </p>
            {reasonError && (
              <p id="suspend-reason-error" role="alert" className="text-xs font-medium text-destructive">
                {reasonError}
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Their plan isn’t cancelled: if they pay by the month, Paystack keeps renewing it while they’re suspended.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                void suspend();
              }}
            >
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Suspend workspace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>

      <AlertDialogRoot open={dialog === 'restore'} onOpenChange={(open) => !pending && setDialog(open ? 'restore' : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore {org.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its dashboard and shop reopen as they were, within seconds. The owners are emailed to say so.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                void restore();
              }}
            >
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Restore workspace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{children}</dd>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="rounded-lg border bg-card shadow-xs">
      <div className="border-b px-5 py-3.5">
        <h2 id={id} className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
