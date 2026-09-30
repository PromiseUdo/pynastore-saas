'use client';

/*
 * Settings → Domain (ROADMAP 12.6). One page, whichever state the shop's
 * domain is in: none yet (buy or connect), waiting on DNS records, with our
 * team (a timeline against the 24-hour promise), live, due to renew,
 * expired, or failed. Every price is in naira and quoted again on the
 * server before any charge.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Copy, ExternalLink, Globe, Loader2, Lock, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { cn } from '@/lib/utils';
import { formatDate, formatMoney, formatRelativeTime } from '@/lib/format';
import { isOverdue, orderTimeline, renewalDeadline, renewalStage, PROMISE_HOURS, type DnsRecord } from '@/lib/domains/rules';
import {
  buyDomain,
  checkMyDomain,
  connectDomain,
  removeDomain,
  renewDomain,
  searchComDomain,
  type DomainOffer,
  type DomainSearchResult,
} from '@/features/domains/actions';

export interface DomainPageData {
  platformUrl: string;
  domain: null | {
    hostname: string;
    canonicalHost: string;
    source: 'REGISTERED' | 'CONNECTED';
    status: 'PENDING' | 'LIVE' | 'EXPIRED' | 'DISCONNECTED' | 'FAILED';
    expiresAt: Date | null;
    dnsOk: boolean;
    dnsCheckedAt: Date | null;
  };
  order: null | {
    type: 'REGISTER' | 'EXISTING' | 'RENEW';
    status: string;
    readyAt: Date;
    stepRegisteredAt: Date | null;
    stepDnsAt: Date | null;
    stepHostAt: Date | null;
    fulfilledAt: Date | null;
    failureReason: string | null;
    paid: boolean;
    refundedAt: Date | null;
  };
  renewalPaid: boolean;
  renewNgn: number | null;
  records: DnsRecord[];
  paidPlan: boolean;
  canBuy: boolean;
  canConnect: boolean;
}

export function DomainClient({ data }: { data: DomainPageData }) {
  const { domain, order } = data;
  const active = domain && ['PENDING', 'LIVE', 'EXPIRED'].includes(domain.status) ? domain : null;
  const expiredGone = active?.status === 'EXPIRED' && active.expiresAt && renewalStage(active.expiresAt, new Date()) === 'released';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {domain?.status === 'FAILED' && order?.status === 'FAILED' && (
        <Notice tone="danger" title={`We couldn’t set up ${domain.hostname}`}>
          <p>{order.failureReason}</p>
          {order.paid && (
            <p className="mt-1">
              {order.refundedAt
                ? `Your payment was refunded on ${formatDate(order.refundedAt)}.`
                : 'Your payment is being returned to you — it can take a few working days to reach your account.'}
            </p>
          )}
        </Notice>
      )}

      {active && !expiredGone ? (
        <CurrentDomain data={data} domain={active} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Your shop is at{' '}
            <a href={data.platformUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
              {data.platformUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </a>
            . Give it an address of its own:
          </p>
          <BuyCard data={data} />
          <ConnectCard canConnect={data.canConnect} />
        </>
      )}
    </div>
  );
}

/* ─── No domain yet ─────────────────────────────────────────────────────── */

function BuyCard({ data }: { data: DomainPageData }) {
  const [query, setQuery] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [result, setResult] = React.useState<DomainSearchResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [buying, setBuying] = React.useState<DomainOffer | null>(null);
  const [paying, setPaying] = React.useState(false);

  const locked = !data.paidPlan;

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSearching(true);
    const r = await searchComDomain(query);
    setSearching(false);
    if (!r.success) setError(r.error);
    else setResult(r.data);
  }

  async function pay() {
    if (!buying) return;
    setPaying(true);
    const r = await buyDomain(buying.domain);
    if (!r.success) {
      setPaying(false);
      setBuying(null);
      toast.error(r.error);
      return;
    }
    window.location.href = r.data.authorizationUrl;
  }

  return (
    <Card title="Get a new domain" description=".com addresses. We register it in your business’s name and connect it for you.">
      {locked ? (
        <div className="flex flex-col gap-3 rounded-md bg-muted/50 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-muted-foreground">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            Buying a domain needs a paid plan. You can still connect a domain you already own, below.
          </p>
          {data.canBuy && (
            <Link href="/upgrade" className={buttonVariants({ size: 'sm', variant: 'outline', className: 'shrink-0' })}>
              See plans
            </Link>
          )}
        </div>
      ) : !data.canBuy ? (
        <p className="text-sm text-muted-foreground">Someone who manages billing can buy a domain for your shop.</p>
      ) : (
        <>
          <form role="search" onSubmit={search} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                aria-label="Domain name"
                placeholder="adafabrics"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8"
                endAdornment={<span className="text-sm text-muted-foreground">.com</span>}
              />
            </div>
            <Button type="submit" size="sm" disabled={searching || !query.trim()}>
              {searching && <Loader2 className="size-3.5 animate-spin" />}
              Search
            </Button>
          </form>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {result?.available && <OfferRow offer={result.offer} headline onChoose={setBuying} />}
          {result && !result.available && (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm text-foreground">
                <X className="size-4 text-destructive" aria-hidden />
                {result.domain} is taken.
                {result.suggestions.length ? ' These are available:' : ' Try another name.'}
              </p>
              {result.suggestions.map((s) => (
                <OfferRow key={s.domain} offer={s} onChoose={setBuying} />
              ))}
            </div>
          )}
        </>
      )}

      <AlertDialogRoot open={buying !== null} onOpenChange={(o) => !paying && !o && setBuying(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Buy {buying?.domain}?</AlertDialogTitle>
            <AlertDialogDescription>
              {buying && (
                <>
                  {formatMoney(buying.priceNgn)} for the first year, then {formatMoney(buying.renewNgn)} a year when you renew. It’s
                  registered in your business’s name, with the padlock and the www address included, and is usually ready within{' '}
                  {PROMISE_HOURS} hours.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={paying}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={paying}
              onClick={(e) => {
                e.preventDefault();
                void pay();
              }}
            >
              {paying && <Loader2 className="size-3.5 animate-spin" />}
              Pay {buying ? formatMoney(buying.priceNgn) : ''} with Paystack
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </Card>
  );
}

function OfferRow({ offer, headline, onChoose }: { offer: DomainOffer; headline?: boolean; onChoose: (o: DomainOffer) => void }) {
  return (
    <div className={cn('flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between', headline && 'border-emerald-300 dark:border-emerald-800')}>
      <div>
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          {headline && <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />}
          {offer.domain}
          {headline && <span className="font-normal text-muted-foreground"> is available</span>}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatMoney(offer.priceNgn)} for the first year · renews at {formatMoney(offer.renewNgn)} a year · usually ready within{' '}
          {PROMISE_HOURS} hours
        </p>
      </div>
      <Button size="sm" variant={headline ? 'default' : 'outline'} onClick={() => onChoose(offer)}>
        Buy {offer.domain}
      </Button>
    </div>
  );
}

function ConnectCard({ canConnect }: { canConnect: boolean }) {
  const router = useRouter();
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const r = await connectDomain(value);
    setPending(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    toast.success(`Next: point ${r.data.domain} at your shop`);
    router.refresh();
  }

  return (
    <Card title="Connect a domain you own" description="Free. You keep it at your registrar and renew it there.">
      {canConnect ? (
        <form onSubmit={submit} className="space-y-2">
          <Label htmlFor="own-domain">Your domain</Label>
          <div className="flex gap-2">
            <Input
              id="own-domain"
              placeholder="yourshop.com"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'own-domain-error' : undefined}
            />
            <Button type="submit" size="sm" variant="outline" disabled={pending || !value.trim()}>
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Connect
            </Button>
          </div>
          {error && (
            <p id="own-domain-error" role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          )}
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">An owner or admin can connect a domain.</p>
      )}
    </Card>
  );
}

/* ─── A domain in progress, live, or expired ────────────────────────────── */

function CurrentDomain({ data, domain }: { data: DomainPageData; domain: NonNullable<DomainPageData['domain']> }) {
  const router = useRouter();
  const [removing, setRemoving] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const { order } = data;
  const now = new Date();
  const inProgress = order && order.status === 'PENDING_FULFILLMENT' && order.type !== 'RENEW';

  async function remove() {
    setRemoving(true);
    const r = await removeDomain();
    setRemoving(false);
    setConfirmRemove(false);
    if (!r.success) return toast.error(r.error);
    toast.success('Domain removed — your shop is back on its platform address');
    router.refresh();
  }

  return (
    <>
      <Card
        title={domain.canonicalHost}
        description={domain.source === 'REGISTERED' ? 'Registered through us, in your business’s name.' : 'Your own domain, at your registrar.'}
        badge={
          domain.status === 'LIVE' ? (
            <Badge variant="success">Live</Badge>
          ) : domain.status === 'EXPIRED' ? (
            <Badge variant="destructive">Expired</Badge>
          ) : (
            <Badge variant="pending">Setting up</Badge>
          )
        }
      >
        {domain.status === 'LIVE' && (
          <p className="text-sm text-foreground">
            Your shop opens at{' '}
            <a href={`https://${domain.canonicalHost}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              {domain.canonicalHost}
              <ExternalLink className="size-3" aria-hidden />
            </a>
            . {domain.hostname} and your old shop address both send shoppers there.
          </p>
        )}

        {domain.status === 'PENDING' && domain.source === 'CONNECTED' && !inProgress && (
          <DnsInstructions domain={domain.hostname} records={data.records} canConnect={data.canConnect} lastCheck={domain.dnsCheckedAt} />
        )}

        {inProgress && order && <Timeline order={order} now={now} />}

        {domain.source === 'REGISTERED' && domain.expiresAt && (
          <Renewal data={data} expiresAt={domain.expiresAt} status={domain.status} hostname={domain.hostname} />
        )}

        {domain.source === 'CONNECTED' && domain.status === 'LIVE' && (
          <p className="text-xs text-muted-foreground">You renew this domain at your own registrar. Keep its records pointing at us, or your shop address will stop working.</p>
        )}

        {data.canConnect && (
          <div className="border-t pt-3">
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmRemove(true)}>
              Remove this domain
            </Button>
          </div>
        )}
      </Card>

      <AlertDialogRoot open={confirmRemove} onOpenChange={(o) => !removing && setConfirmRemove(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {domain.hostname}?</AlertDialogTitle>
            <AlertDialogDescription>
              Your shop stops opening at {domain.canonicalHost} straight away and goes back to its platform address. Links to the domain
              stop working.
              {domain.source === 'REGISTERED'
                ? ' The domain stays yours at the registrar until it expires, but we won’t renew it.'
                : ' The domain stays yours at your registrar.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              disabled={removing}
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              {removing && <Loader2 className="size-3.5 animate-spin" />}
              Remove domain
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </>
  );
}

function Timeline({ order, now }: { order: NonNullable<DomainPageData['order']>; now: Date }) {
  const steps = orderTimeline(order);
  const overdue = isOverdue(order.readyAt, Boolean(order.fulfilledAt), now);
  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {steps.map((s, i) => {
          const current = !s.at && steps.slice(0, i).every((p) => p.at);
          return (
            <li key={s.key} className="flex items-center gap-3 text-sm">
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full',
                  s.at ? 'bg-emerald-600 text-white dark:bg-emerald-500' : current ? 'border-2 border-primary' : 'border',
                )}
                aria-hidden
              >
                {s.at && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className={s.at ? 'text-foreground' : current ? 'font-medium text-foreground' : 'text-muted-foreground'}>{s.label}</span>
              {s.at && <span className="text-xs text-muted-foreground">{formatRelativeTime(s.at, now)}</span>}
              <span className="sr-only">{s.at ? '— done' : current ? '— in progress' : '— to do'}</span>
            </li>
          );
        })}
      </ol>
      {overdue ? (
        <Notice tone="warning" title="This is taking longer than we promised">
          We aimed to have it ready within {PROMISE_HOURS} hours and we’re sorry it isn’t yet. Our team has been reminded; you’ll get an
          email the moment it’s live.
        </Notice>
      ) : (
        <p className="text-xs text-muted-foreground">
          Usually ready within {PROMISE_HOURS} hours of {order.type === 'EXISTING' ? 'your records being found' : 'paying'}. We’ll email you
          when it’s live.
        </p>
      )}
    </div>
  );
}

function DnsInstructions({
  domain,
  records,
  canConnect,
  lastCheck,
}: {
  domain: string;
  records: DnsRecord[];
  canConnect: boolean;
  lastCheck: Date | null;
}) {
  const router = useRouter();
  const [checking, setChecking] = React.useState(false);
  const [result, setResult] = React.useState<null | { apex: { ok: boolean; found: string[] }; www: { ok: boolean; found: string[] }; ok: boolean }>(null);

  async function check() {
    setChecking(true);
    const r = await checkMyDomain();
    setChecking(false);
    if (!r.success) return toast.error(r.error);
    setResult(r.data);
    if (r.data.queued) {
      toast.success('Your records are right — we’ll finish connecting it');
      router.refresh();
    }
  }

  const copy = (v: string) => {
    void navigator.clipboard?.writeText(v).then(() => toast.success('Copied'));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground">
        Sign in where you bought <span className="font-medium">{domain}</span> and add these two records in its DNS settings. Remove any
        other A or CNAME records for the same names first.
      </p>
      <TableWrapper>
        <Table dense>
          <TableHead>
            <TableRow>
              <TableColumnHeader>Type</TableColumnHeader>
              <TableColumnHeader>Name (host)</TableColumnHeader>
              <TableColumnHeader>Value (points to)</TableColumnHeader>
              <TableColumnHeader>
                <span className="sr-only">Copy</span>
              </TableColumnHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.map((r) => (
              <TableRow key={r.type}>
                <TableCell className="font-mono text-xs">{r.type}</TableCell>
                <TableCell className="font-mono text-xs">{r.name}</TableCell>
                <TableCell className="font-mono text-xs">{r.value}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" aria-label={`Copy ${r.type} value`} onClick={() => copy(r.value)}>
                    <Copy className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrapper>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Where do I find the DNS settings?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Namecheap: Domain List → Manage → Advanced DNS → Add new record.</li>
          <li>GoDaddy: My Products → DNS → Add. Use “@” for the domain itself.</li>
          <li>Whogohost: Client area → Domains → Manage DNS.</li>
          <li>Cloudflare: DNS → Records → Add record, with the proxy (orange cloud) turned off.</li>
        </ul>
        <p className="mt-2">Changes can take from a few minutes to a few hours to show. Check again after a while if they aren’t found yet.</p>
      </details>
      {canConnect && (
        <div className="space-y-2">
          <Button size="sm" onClick={check} disabled={checking}>
            {checking && <Loader2 className="size-3.5 animate-spin" />}
            Check my domain
          </Button>
          {!result && lastCheck && <p className="text-xs text-muted-foreground">Last checked {formatRelativeTime(lastCheck, new Date())} — not found yet.</p>}
          {result && !result.ok && (
            <ul className="space-y-1 text-sm">
              <RecordResult ok={result.apex.ok} label={`${domain} (A record)`} found={result.apex.found} />
              <RecordResult ok={result.www.ok} label={`www.${domain} (CNAME record)`} found={result.www.found} />
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function RecordResult({ ok, label, found }: { ok: boolean; label: string; found: string[] }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      ) : (
        <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      )}
      <span>
        {label}: {ok ? 'correct' : found.length ? `points to ${found.join(', ')} — change it to the value above` : 'not found yet'}
      </span>
    </li>
  );
}

function Renewal({
  data,
  expiresAt,
  status,
  hostname,
}: {
  data: DomainPageData;
  expiresAt: Date;
  status: string;
  hostname: string;
}) {
  const [paying, setPaying] = React.useState(false);
  const now = new Date();
  const stage = renewalStage(expiresAt, now);
  const deadline = renewalDeadline(expiresAt);

  async function renew() {
    setPaying(true);
    const r = await renewDomain();
    if (!r.success) {
      setPaying(false);
      toast.error(r.error);
      return;
    }
    window.location.href = r.data.authorizationUrl;
  }

  const canRenew = data.canBuy && !data.renewalPaid && (stage === 'renew_soon' || stage === 'past_deadline' || stage === 'grace' || stage === 'ok');
  return (
    <div className="space-y-3 rounded-md border p-4">
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Registered until</dt>
          <dd className="font-medium text-foreground">{formatDate(expiresAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Renew by</dt>
          <dd className="font-medium text-foreground">{formatDate(deadline)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Renewal</dt>
          <dd className="font-medium text-foreground tabular-nums">{data.renewNgn !== null ? `${formatMoney(data.renewNgn)} a year` : 'Price unavailable right now'}</dd>
        </div>
      </dl>

      {data.renewalPaid ? (
        <p className="text-sm text-foreground">Renewal paid — we’re completing it with the registrar. You’ll get an email when it’s done.</p>
      ) : stage === 'renew_soon' ? (
        <Notice tone="warning" title={`Renew by ${formatDate(deadline)}`}>
          We need a week to complete a renewal with the registrar, so please renew before then.
        </Notice>
      ) : stage === 'past_deadline' ? (
        <Notice tone="danger" title={`Renew now, or your address stops working on ${formatDate(expiresAt)}`}>
          The renewal deadline has passed. You can still renew until it expires.
        </Notice>
      ) : stage === 'grace' ? (
        <Notice tone="danger" title={`${hostname} expired on ${formatDate(expiresAt)}`}>
          Your shop is back on its platform address. Renew at the normal price in the next few weeks to get the domain back.
        </Notice>
      ) : stage === 'redemption' ? (
        <Notice tone="danger" title={`${hostname} expired and the registry has deleted it`}>
          It can still be recovered, but it costs the registry’s recovery fee on top of the renewal. Contact us and we’ll tell you the exact
          cost. We can’t pay it on your behalf.
        </Notice>
      ) : status === 'LIVE' ? null : null}

      {data.canBuy ? (
        canRenew && (
          <Button size="sm" variant={stage === 'ok' ? 'outline' : 'default'} onClick={renew} disabled={paying || data.renewNgn === null}>
            {paying && <Loader2 className="size-3.5 animate-spin" />}
            Renew for a year{data.renewNgn !== null ? ` — ${formatMoney(data.renewNgn)}` : ''}
          </Button>
        )
      ) : (
        <p className="text-xs text-muted-foreground">Someone who manages billing can renew it.</p>
      )}
    </div>
  );
}

/* ─── Bits ──────────────────────────────────────────────────────────────── */

function Card({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="rounded-lg border bg-card shadow-xs">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-3.5">
        <div className="min-w-0">
          <h2 id={id} className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Globe className="size-4 text-muted-foreground" aria-hidden />
            {title}
          </h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {badge}
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}

function Notice({ tone, title, children }: { tone: 'warning' | 'danger'; title: string; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'rounded-md border p-3 text-sm',
        tone === 'warning'
          ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200'
          : 'border-destructive/30 bg-destructive/5 text-foreground',
      )}
    >
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {title}
      </p>
      <div className="mt-1 pl-6">{children}</div>
    </div>
  );
}
