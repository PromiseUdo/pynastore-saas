'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Copy, Download, Loader2 } from 'lucide-react';
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
import { formatDate, formatMoney } from '@/lib/format';
import { appStateBadge } from '@/lib/mobile/labels';
import {
  markAppBuilding,
  markAppDelivered,
  recordAppListings,
  setAppSwitchedOff,
  updateAppIdentity,
  type AppOrderDetail,
} from '@/features/platform/mobile-apps';

export function AppOrderClient({ app }: { app: AppOrderDetail }) {
  const router = useRouter();
  const badge = appStateBadge({ stage: app.stage, status: app.status, graceEndsAt: app.renewal.graceEndsAt });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [switchDialog, setSwitchDialog] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const paid = app.stage !== 'REQUESTED';
  const slug = app.organization.slug;

  async function run(key: string, action: () => Promise<{ success: boolean; error?: string }>, done: string) {
    setBusy(key);
    const r = await action();
    setBusy(null);
    if (!r.success) return toast.error(r.error ?? 'Something went wrong');
    toast.success(done);
    router.refresh();
  }

  const copy = (v: string) => void navigator.clipboard?.writeText(v).then(() => toast.success('Copied'));
  const commands = [
    `npm run mobile:app -- init ${slug}`,
    `npm run mobile:app -- check ${slug}`,
    `npm run mobile:app -- build ${slug}${app.platforms.ios ? '' : ' --platform android'}${!app.platforms.android ? ' --platform ios' : ''}`,
    `npm run mobile:app -- listing ${slug} --reviewer-account`,
  ];

  return (
    <div>
      <div className="border-b bg-background px-4 py-4 sm:px-6">
        <Link href="/platform/mobile-apps" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" aria-hidden /> Store apps
        </Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{app.name}</h1>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <div className="flex gap-2">
            {paid && (
              <Button variant="outline" size="sm" onClick={() => setSwitchDialog(true)}>
                {app.status === 'LAPSED' ? 'Switch on' : 'Switch off'}
              </Button>
            )}
            {app.stage === 'PAID' && (
              <Button size="sm" disabled={busy !== null} onClick={() => run('building', () => markAppBuilding(app.id), 'Marked as being built')}>
                {busy === 'building' && <Loader2 className="size-3.5 animate-spin" />}
                Start building
              </Button>
            )}
          </div>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          For{' '}
          <Link href={`/platform/merchants/${app.organization.id}`} className="text-primary hover:underline">
            {app.organization.name}
          </Link>
          {app.dates.paid ? ` · paid ${formatDate(app.dates.paid)}` : ` · asked ${formatDate(app.dates.requested)}, not paid`}
          {app.renewal.paidThrough ? ` · paid until ${formatDate(app.renewal.paidThrough)}` : ''}
        </p>
      </div>

      <div className="grid gap-6 px-4 py-6 sm:px-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Identity app={app} />

          {paid && (
            <Section title="Build it" description="On the build Mac, with DATABASE_URL set to production. The kit reads everything below from this order; init downloads the icon.">
              <ul className="space-y-1 font-mono text-xs">
                {commands.map((c) => (
                  <li key={c} className="flex items-center gap-2">
                    <span className="flex-1 break-all">{c}</span>
                    <Button variant="ghost" size="sm" aria-label="Copy command" onClick={() => copy(c)}>
                      <Copy className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
              {app.platforms.ios && !app.iosPush && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  No APNs key recorded yet — the iPhone app won’t offer order notifications until it is (docs/MOBILE-BUILD.md §2).
                </p>
              )}
            </Section>
          )}

          {paid && <Delivery app={app} />}
          {(app.stage === 'DELIVERED' || app.stage === 'LIVE') && <Listings app={app} />}
        </div>

        <div className="space-y-6">
          <Section title="What they asked for">
            {app.icon ? (
              <div className="flex items-center gap-3">
                <span className="flex size-16 items-center justify-center rounded-xl border p-1" style={{ background: app.backgroundColor ?? undefined }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a Cloudinary thumbnail */}
                  <img src={app.icon.url} alt="" className="size-full object-contain" />
                </span>
                <a href={app.icon.pngUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  <Download className="size-3.5" aria-hidden /> Icon (1024 PNG)
                </a>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No icon.</p>
            )}
            <dl className="space-y-2 text-sm">
              <Fact label="Phones">{[app.platforms.android && 'Android', app.platforms.ios && 'iPhone'].filter(Boolean).join(' and ')}</Fact>
              <Fact label="Background colour">{app.backgroundColor ?? '—'}</Fact>
              <Fact label="One line about the shop">{app.shortDescription ?? '—'}</Fact>
            </dl>
          </Section>

          <Section title="Payments">
            {app.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {app.payments.map((p) => (
                  <li key={p.reference} className="flex justify-between gap-2">
                    <span>
                      {p.kind === 'SETUP' ? 'Setup' : 'Renewal'}
                      <span className="block text-xs text-muted-foreground">{p.paidAt ? formatDate(p.paidAt) : 'not completed'}</span>
                    </span>
                    <span className="tabular-nums">{formatMoney(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <AlertDialogRoot open={switchDialog} onOpenChange={setSwitchDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{app.status === 'LAPSED' ? 'Switch the app back on?' : 'Switch the app off?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {app.status === 'LAPSED'
                ? 'Customers can use it again straight away. If its year isn’t paid, tomorrow’s renewal job starts the grace period again.'
                : 'Everyone who opens it sees that it’s no longer available, with a link to the store’s website. Renewing switches it back on.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {app.status !== 'LAPSED' && (
            <div className="space-y-1.5">
              <Label htmlFor="switch-reason">Why (for the record)</Label>
              <Textarea id="switch-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                run('switch', () => setAppSwitchedOff(app.id, app.status !== 'LAPSED', reason), app.status === 'LAPSED' ? 'Switched on' : 'Switched off')
              }
            >
              {app.status === 'LAPSED' ? 'Switch on' : 'Switch off'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </div>
  );
}

function Identity({ app }: { app: AppOrderDetail }) {
  const router = useRouter();
  const [appId, setAppId] = React.useState(app.appId);
  const [name, setName] = React.useState(app.name);
  const [saving, setSaving] = React.useState(false);
  const dirty = appId !== app.appId || name !== app.name;
  return (
    <Section
      title="App id and name"
      description={app.appIdLocked ? 'The id is permanent now that the app has been delivered.' : 'Check the id before building: once the app is published it can never change.'}
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          const r = await updateAppIdentity(app.id, { appId, name });
          setSaving(false);
          if (!r.success) return toast.error(r.error);
          toast.success('Saved');
          router.refresh();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="app-id">App id</Label>
          <Input id="app-id" value={appId} disabled={app.appIdLocked} onChange={(e) => setAppId(e.target.value)} className="font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="app-name">Name under the icon</Label>
          <Input id="app-name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        </div>
        {dirty && (
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        )}
      </form>
    </Section>
  );
}

function Delivery({ app }: { app: AppOrderDetail }) {
  const router = useRouter();
  const [form, setForm] = React.useState({
    versionName: app.delivery.versionName ?? '1.0.0',
    buildNumber: app.delivery.buildNumber ? String(app.delivery.buildNumber) : '1',
    downloadUrl: app.delivery.downloadUrl ?? '',
    note: app.delivery.note ?? '',
  });
  const [saving, setSaving] = React.useState(false);
  const delivered = app.stage === 'DELIVERED' || app.stage === 'LIVE';
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Section
      title={delivered ? 'Delivered build' : 'Deliver it'}
      description={
        delivered
          ? `Delivered ${formatDate(app.dates.delivered!)}. Record a newer build here when you send one.`
          : 'When the build is done and tested: put the Android files somewhere the merchant can download them, then record it. The merchant is emailed.'
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          const r = await markAppDelivered(app.id, { ...form, buildNumber: Number(form.buildNumber) });
          setSaving(false);
          if (!r.success) return toast.error(r.error);
          toast.success(delivered ? 'Build recorded' : 'Delivered — the merchant has been emailed');
          router.refresh();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="version">Version</Label>
          <Input id="version" value={form.versionName} onChange={(e) => set('versionName', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="build">Build number</Label>
          <Input id="build" inputMode="numeric" value={form.buildNumber} onChange={(e) => set('buildNumber', e.target.value)} />
        </div>
        {app.platforms.android && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="download">
              Link to the Android files (.aab and .apk) <span className="text-destructive">*</span>
            </Label>
            <Input id="download" value={form.downloadUrl} onChange={(e) => set('downloadUrl', e.target.value)} placeholder="https://drive.google.com/…" />
            <p className="text-xs text-muted-foreground">A shared folder only the merchant can open. Never share the signing key.</p>
          </div>
        )}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="note">Note to the merchant</Label>
          <Textarea id="note" rows={3} value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="e.g. The iPhone build is in your App Store Connect, under TestFlight." />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" disabled={saving}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {delivered ? 'Record this build' : 'Mark delivered'}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function Listings({ app }: { app: AppOrderDetail }) {
  const router = useRouter();
  const [appStoreId, setAppStoreId] = React.useState(app.listing.appStoreId ?? '');
  const [play, setPlay] = React.useState(app.listing.onGooglePlay);
  const [saving, setSaving] = React.useState(false);
  return (
    <Section
      title="Listings"
      description="Once Apple or Google approves it. Any listing makes the app live, emails the merchant, and lets their website offer it."
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          const r = await recordAppListings(app.id, { appStoreId, onGooglePlay: play });
          setSaving(false);
          if (!r.success) return toast.error(r.error);
          toast.success('Listings saved');
          router.refresh();
        }}
      >
        {app.platforms.ios && (
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="app-store-id">App Store id</Label>
            <Input id="app-store-id" inputMode="numeric" value={appStoreId} onChange={(e) => setAppStoreId(e.target.value)} placeholder="1234567890" />
            <p className="text-xs text-muted-foreground">The number in apps.apple.com/app/id…</p>
          </div>
        )}
        {app.platforms.android && (
          <label className="flex items-center gap-2 text-sm">
            <CheckboxRoot checked={play} onCheckedChange={(v) => setPlay(v === true)} /> Live on Google Play
          </label>
        )}
        <p className="text-xs text-muted-foreground">
          The merchant’s website {app.listing.promoteOnWebsite ? 'offers' : 'doesn’t offer'} the app (their choice, in Settings → Mobile app).
        </p>
        <Button type="submit" size="sm" disabled={saving}>
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Save listings
        </Button>
      </form>
    </Section>
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
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{children}</dd>
    </div>
  );
}
