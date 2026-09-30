/*
 * Platform console → Overview (ROADMAP 11.0).
 *
 * What needs staff attention first, then how the platform's workspaces stand.
 * Only figures the code can already stand behind: work waiting in a queue
 * that exists, and plan states from the same rule merchants are held to.
 * Each workspace figure opens the merchant list filtered to what it counts
 * (11.2).
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle, ArrowRight, BadgeCheck, Building2, CheckCircle2, Clock, Lock, ShieldAlert, Sparkles } from 'lucide-react';
import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/layout/page-header';
import { getPlatformStaff } from '@/lib/platform-staff';
import { StatCard, StatGrid } from '@/components/dashboard/stat-card';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatNumber, formatRelativeTime } from '@/lib/format';
import { getConsoleOverview } from '@/features/platform/overview';
import { getPaymentCounts } from '@/features/platform/payments';
import { waitingDomainCount } from '@/features/platform/domains';
import { jobsAttentionCount } from '@/features/platform/jobs';

export const metadata: Metadata = { title: 'Overview' };

export default async function ConsoleOverviewPage() {
  // The layout's staff check runs alongside this page, not before it.
  if (!(await getPlatformStaff())) notFound();
  const [{ verification, workspaces }, payments, domainsWaiting, jobsNeedingLook] = await Promise.all([
    getConsoleOverview(),
    getPaymentCounts(),
    waitingDomainCount(),
    jobsAttentionCount(),
  ]);
  const p = payments.success ? payments.data : null;
  const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;
  // Everything else waiting on the team, each opening its list.
  const others = [
    p?.disputes ? { href: '/platform/payments?tab=disputes', text: `${plural(p.disputes, 'chargeback is', 'chargebacks are')} open` } : null,
    p?.mismatched ? { href: '/platform/payments?tab=mismatched', text: `${plural(p.mismatched, 'payment', 'payments')} came in for the wrong amount or account` } : null,
    p?.unmatched ? { href: '/platform/payments?tab=unmatched', text: `${plural(p.unmatched, 'Paystack payment matches', 'Paystack payments match')} nothing of ours` } : null,
    p?.payouts ? { href: '/platform/payments?tab=payouts', text: `${plural(p.payouts, 'business needs', 'businesses need')} its payout setup fixed` } : null,
    jobsNeedingLook ? { href: '/platform/jobs', text: `${plural(jobsNeedingLook, 'scheduled job is', 'scheduled jobs are')} failing or not running` } : null,
    domainsWaiting ? { href: '/platform/domains', text: `${plural(domainsWaiting, 'domain is', 'domains are')} waiting to be set up or renewed` } : null,
  ].filter((x): x is { href: string; text: string } => x !== null);
  const { byState } = workspaces;

  return (
    <>
      <PageHeader title="Overview" description="What's waiting for the team, and how merchants' workspaces stand today." />
      <PageBody>
        <div className="space-y-8">
          <section aria-labelledby="attention" className="space-y-3">
            <h2 id="attention" className="text-sm font-semibold text-foreground">
              Needs attention
            </h2>
            {verification.pending > 0 && (
              <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    {verification.pending === 1
                      ? '1 business is waiting for its payment details to be checked'
                      : `${formatNumber(verification.pending)} businesses are waiting for their payment details to be checked`}
                    {verification.oldestSubmittedAt
                      ? ` — the oldest was sent ${formatRelativeTime(verification.oldestSubmittedAt)}.`
                      : '.'}{' '}
                    They can't take online payments until then.
                  </span>
                </p>
                <Link href="/platform/verification" className={buttonVariants({ size: 'sm', className: 'shrink-0 self-start sm:self-auto' })}>
                  Review now
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </div>
            )}
            {others.length > 0 && (
              <ul className="divide-y rounded-lg border bg-card text-sm">
                {others.map((o) => (
                  <li key={o.href + o.text}>
                    <Link href={o.href} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                      <span className="flex items-start gap-2 text-foreground">
                        <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                        {o.text}
                      </span>
                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {verification.pending === 0 && others.length === 0 && (
              <p className="flex items-center gap-2 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                Nothing waiting. Verification requests, payment problems, domain work and failing scheduled jobs will appear here.
              </p>
            )}
          </section>

          <section aria-labelledby="workspaces" className="space-y-3">
            <div>
              <h2 id="workspaces" className="text-sm font-semibold text-foreground">
                Workspaces
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Active workspaces by where they are with their plan, worked out the same way the merchant&apos;s own
                dashboard does; suspended ones are counted on their own. Each figure opens the list it counts.
              </p>
            </div>
            <StatGrid className="lg:grid-cols-3">
              <StatLink href="/platform/merchants?status=active">
                <StatCard
                  title="Workspaces"
                  value={formatNumber(workspaces.total)}
                  icon={Building2}
                  description={`${formatNumber(workspaces.newThisWeek)} new in the last 7 days`}
                />
              </StatLink>
              <StatLink href="/platform/merchants?status=active&plan=active">
                <StatCard title="Paying" value={formatNumber(byState.active)} icon={BadgeCheck} description="On a paid plan" />
              </StatLink>
              <StatLink href="/platform/merchants?status=active&plan=trial">
                <StatCard title="On a free trial" value={formatNumber(byState.trial)} icon={Sparkles} description="Haven't chosen a plan yet" />
              </StatLink>
              <StatLink href="/platform/merchants?status=active&plan=grace">
                <StatCard
                  title="In grace"
                  value={formatNumber(byState.grace)}
                  icon={Clock}
                  description="Plan ended; the shop still takes orders for now"
                />
              </StatLink>
              <StatLink href="/platform/merchants?status=active&plan=lapsed">
                <StatCard
                  title="Closed"
                  value={formatNumber(byState.lapsed)}
                  icon={Lock}
                  description="Plan ended and grace is over; the shop takes no orders"
                />
              </StatLink>
              <StatLink href="/platform/merchants?status=suspended">
                <StatCard
                  title="Suspended"
                  value={formatNumber(workspaces.suspended)}
                  icon={ShieldAlert}
                  description="Closed by the team; not counted above"
                />
              </StatLink>
              {byState.none > 0 && (
                <StatLink href="/platform/merchants?status=active&plan=none">
                  <StatCard
                    title="No subscription"
                    value={formatNumber(byState.none)}
                    icon={AlertCircle}
                    description="Created before trials existed — test data"
                  />
                </StatLink>
              )}
            </StatGrid>
          </section>
        </div>
      </PageBody>
    </>
  );
}

/** A stat card that opens the list it counts (AGENTS §2). */
function StatLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block rounded-lg transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:h-full"
    >
      {children}
    </Link>
  );
}
