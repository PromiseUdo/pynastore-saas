'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Check, Circle, Download, ExternalLink, Loader2, Lock, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckboxRoot } from '@/components/ui/checkbox';
import { SwitchRoot } from '@/components/ui/switch';
import { EmptyState } from '@/components/layout/empty-state';
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
import { ImageUploader, type UploadedImage } from '@/components/media/image-uploader';
import { formatDate, formatMoney } from '@/lib/format';
import { appStateBadge, MERCHANT_NEXT_STEP } from '@/lib/mobile/labels';
import type { RequestErrors } from '@/lib/mobile/orders';
import {
  cancelMobileAppRequestAction,
  payForMobileAppAction,
  saveMobileAppRequestAction,
  setAppPromotionAction,
} from '@/features/mobile-app/actions';

export interface MobileAppPageData {
  pricing: { setupFee: number | null; yearlyFee: number | null; graceDays: number };
  paidPlan: boolean;
  canEdit: boolean;
  canPay: boolean;
  app: {
    stage: string;
    status: string;
    name: string;
    icon: { url: string; publicId: string } | null;
    backgroundColor: string;
    shortDescription: string;
    wantsAndroid: boolean;
    wantsIos: boolean;
    paidAt: Date | null;
    buildingAt: Date | null;
    deliveredAt: Date | null;
    liveAt: Date | null;
    versionName: string | null;
    downloadUrl: string | null;
    deliveryNote: string | null;
    paidThrough: Date | null;
    graceEndsAt: Date | null;
    canRenew: boolean;
    appStoreUrl: string | null;
    googlePlayUrl: string | null;
    promoteOnWebsite: boolean;
    payments: { kind: string; amount: number; paidAt: Date }[];
  } | null;
}

export function MobileAppClient({ data }: { data: MobileAppPageData }) {
  useCheckoutToast();
  const { pricing, app } = data;

  if (pricing.setupFee === null || pricing.yearlyFee === null) {
    return (
      <EmptyState
        icon={Smartphone}
        title="Store apps are coming soon"
        description="Your shop’s own Android and iPhone app isn’t on sale yet. This page will let you order one when it is."
      />
    );
  }

  if (!app) return <Offer data={data} setupFee={pricing.setupFee} yearlyFee={pricing.yearlyFee} />;
  if (app.stage === 'REQUESTED') return <Unpaid data={data} app={app} setupFee={pricing.setupFee} />;
  return <Ordered data={data} app={app} yearlyFee={pricing.yearlyFee} />;
}

/* After Paystack: one toast, then the URL is tidied so a refresh doesn't repeat it. */
function useCheckoutToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const outcome = params.get('checkout');
  React.useEffect(() => {
    if (!outcome) return;
    if (outcome === 'success') toast.success('Payment received — thank you');
    else toast.error('The payment didn’t go through. You haven’t been charged.');
    router.replace(pathname);
  }, [outcome, pathname, router]);
}

function Card({ title, description, children, aside }: { title: string; description?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="rounded-lg border bg-card shadow-xs">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-3.5">
        <div>
          <h2 id={id} className="text-sm font-semibold text-foreground">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}

async function goToPayment(kind: 'SETUP' | 'RENEWAL', setBusy: (b: boolean) => void) {
  setBusy(true);
  const r = await payForMobileAppAction(kind);
  if (!r.success) {
    setBusy(false);
    toast.error(r.error);
    return;
  }
  window.location.href = r.data.authorizationUrl;
}

/* ── no app yet ─────────────────────────────────────────────────────── */

function Offer({ data, setupFee, yearlyFee }: { data: MobileAppPageData; setupFee: number; yearlyFee: number }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card title="Your shop’s own app" description={`${formatMoney(setupFee)} to set up, including the first year, then ${formatMoney(yearlyFee)} a year.`}>
        <ul className="space-y-2 text-sm">
          {[
            'Your name and icon on customers’ phones, for Android and iPhone.',
            'It opens straight into your shop — your products, prices and look, always up to date.',
            'Customers can turn on notifications about their orders.',
            'We build it and prepare everything the App Store and Google Play ask for.',
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
        <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          You publish the app from your own accounts, so it appears under your business’s name: an Apple Developer
          account ($99 a year, paid to Apple) and a Google Play developer account ($25 once, paid to Google). We’ll
          guide you through both.
        </p>
      </Card>

      {!data.paidPlan ? (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-sm shadow-xs sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-muted-foreground">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />A store app needs a paid plan.
          </p>
          {data.canPay && (
            <Link href="/upgrade" className={buttonVariants({ size: 'sm', variant: 'outline', className: 'shrink-0' })}>
              See plans
            </Link>
          )}
        </div>
      ) : !data.canEdit ? (
        <p className="text-sm text-muted-foreground">Someone who can change your shop’s settings can order an app.</p>
      ) : (
        <RequestForm data={data} payLabel={`Continue to payment — ${formatMoney(setupFee)}`} />
      )}
    </div>
  );
}

/* ── asked for, not paid ────────────────────────────────────────────── */

function Unpaid({ data, app, setupFee }: { data: MobileAppPageData; app: NonNullable<MobileAppPageData['app']>; setupFee: number }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [withdrawing, setWithdrawing] = React.useState(false);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card
        title="Payment needed"
        description={MERCHANT_NEXT_STEP.REQUESTED}
        aside={<Badge variant="draft">Not paid yet</Badge>}
      >
        {data.paidPlan && data.canPay ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => goToPayment('SETUP', setBusy)} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Pay {formatMoney(setupFee)}
            </Button>
            {data.canEdit && (
              <Button variant="ghost" onClick={() => setWithdrawing(true)}>
                Withdraw request
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data.paidPlan ? 'Someone who manages billing can pay for it.' : 'A store app needs a paid plan. '}
            {!data.paidPlan && data.canPay && (
              <Link href="/upgrade" className="text-primary hover:underline">
                See plans
              </Link>
            )}
          </p>
        )}
      </Card>

      {data.canEdit ? <RequestForm data={data} app={app} /> : <Details app={app} />}

      <AlertDialogRoot open={withdrawing} onOpenChange={setWithdrawing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw your app request?</AlertDialogTitle>
            <AlertDialogDescription>
              The details you entered are deleted. Nothing has been paid, so there’s nothing to refund.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const r = await cancelMobileAppRequestAction();
                if (!r.success) return toast.error(r.error);
                toast.success('Request withdrawn');
                router.refresh();
              }}
            >
              Withdraw request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </div>
  );
}

/* ── the request form ───────────────────────────────────────────────── */

function RequestForm({ data, app, payLabel }: { data: MobileAppPageData; app?: NonNullable<MobileAppPageData['app']>; payLabel?: string }) {
  const router = useRouter();
  const [name, setName] = React.useState(app?.name ?? '');
  const [icon, setIcon] = React.useState<UploadedImage[]>(app?.icon ? [app.icon] : []);
  const [colour, setColour] = React.useState(app?.backgroundColor ?? '#ffffff');
  const [description, setDescription] = React.useState(app?.shortDescription ?? '');
  const [android, setAndroid] = React.useState(app?.wantsAndroid ?? true);
  const [ios, setIos] = React.useState(app?.wantsIos ?? true);
  const [uploading, setUploading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<RequestErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const willPay = Boolean(payLabel) && data.paidPlan && data.canPay;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    const r = await saveMobileAppRequestAction({
      name,
      icon: icon[0] ? { url: icon[0].url, publicId: icon[0].publicId, width: icon[0].width, height: icon[0].height } : null,
      backgroundColor: colour,
      shortDescription: description,
      wantsAndroid: android,
      wantsIos: ios,
    });
    if (!r.success) {
      setSaving(false);
      setErrors(r.fieldErrors ?? {});
      setFormError(r.error);
      return;
    }
    setErrors({});
    if (willPay) return goToPayment('SETUP', setSaving);
    setSaving(false);
    toast.success('Saved');
    router.refresh();
  }

  const err = (f: keyof RequestErrors) =>
    errors[f] ? (
      <p id={`${f}-error`} role="alert" className="text-xs font-medium text-destructive">
        {errors[f]}
      </p>
    ) : null;

  return (
    <form noValidate onSubmit={onSubmit}>
      <Card title="About your app" description="You can change these until we start building.">
        {formError && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="app-name">
            App name <span className="text-destructive">*</span>
          </Label>
          <Input id="app-name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(errors.name)} />
          <p className="text-xs text-muted-foreground">Shown under the icon on customers’ phones. 30 characters at most.</p>
          {err('name')}
        </div>

        <div className="space-y-1.5">
          <Label>
            App icon <span className="text-destructive">*</span>
          </Label>
          <ImageUploader purpose="mobile-app" value={icon} onChange={setIcon} max={1} onBusyChange={setUploading} hint="A square PNG, at least 1024 × 1024 pixels. A transparent background works best." />
          {err('icon')}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="app-colour">
            Background colour <span className="text-destructive">*</span>
          </Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pick a colour"
              value={/^#[0-9a-f]{6}$/i.test(colour) ? colour : '#ffffff'}
              onChange={(e) => setColour(e.target.value)}
              className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
            />
            <Input id="app-colour" value={colour} onChange={(e) => setColour(e.target.value)} className="w-32" aria-invalid={Boolean(errors.backgroundColor)} />
          </div>
          <p className="text-xs text-muted-foreground">Behind your icon, and on the screen shown while the app opens.</p>
          {err('backgroundColor')}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="app-description">One line about your shop</Label>
          <Input id="app-description" value={description} maxLength={80} onChange={(e) => setDescription(e.target.value)} placeholder="Handmade leather bags, delivered across Nigeria" />
          <p className="text-xs text-muted-foreground">For the store listings. In your own words; 80 characters at most.</p>
          {err('shortDescription')}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Phones <span className="text-destructive">*</span>
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <CheckboxRoot checked={android} onCheckedChange={(v) => setAndroid(v === true)} /> Android (Google Play)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <CheckboxRoot checked={ios} onCheckedChange={(v) => setIos(v === true)} /> iPhone (App Store)
          </label>
          {err('platforms')}
        </fieldset>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving || uploading}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {willPay ? payLabel : 'Save details'}
          </Button>
        </div>
      </Card>
    </form>
  );
}

function Details({ app }: { app: NonNullable<MobileAppPageData['app']> }) {
  return (
    <Card title="About your app">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Fact label="Name">{app.name}</Fact>
        <Fact label="Phones">{[app.wantsAndroid && 'Android', app.wantsIos && 'iPhone'].filter(Boolean).join(' and ')}</Fact>
        <Fact label="Background colour">
          <span className="inline-flex items-center gap-2">
            <span className="size-4 rounded border" style={{ background: app.backgroundColor }} aria-hidden />
            {app.backgroundColor}
          </span>
        </Fact>
        <Fact label="One line about your shop">{app.shortDescription || '—'}</Fact>
      </dl>
    </Card>
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

/* ── paid for ───────────────────────────────────────────────────────── */

function Ordered({ data, app, yearlyFee }: { data: MobileAppPageData; app: NonNullable<MobileAppPageData['app']>; yearlyFee: number }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const badge = appStateBadge(app);
  const steps: { label: string; at: Date | null }[] = [
    { label: 'Paid', at: app.paidAt },
    { label: 'Being built', at: app.buildingAt },
    { label: 'Ready to publish', at: app.deliveredAt },
    { label: 'Live in the stores', at: app.liveAt },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {app.status === 'LAPSED' && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Your app is switched off: customers who open it see that it’s no longer available. Renew it to switch it straight back on.
        </p>
      )}
      {app.status !== 'LAPSED' && app.graceEndsAt && (
        <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          Your app’s year has ended. It keeps working until {formatDate(app.graceEndsAt)} — renew it before then.
        </p>
      )}

      <Card title={app.name} description={app.status === 'ACTIVE' ? MERCHANT_NEXT_STEP[app.stage] : undefined} aside={<Badge variant={badge.variant}>{badge.label}</Badge>}>
        <ol className="space-y-2">
          {steps.map((step) => (
            <li key={step.label} className="flex items-center gap-2 text-sm">
              {step.at ? (
                <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
              ) : (
                <Circle className="size-4 text-muted-foreground" aria-hidden />
              )}
              <span className={step.at ? 'text-foreground' : 'text-muted-foreground'}>{step.label}</span>
              {step.at && <span className="text-xs text-muted-foreground">{formatDate(step.at)}</span>}
            </li>
          ))}
        </ol>
      </Card>

      {(app.stage === 'DELIVERED' || app.stage === 'LIVE') && (
        <Card title="Your app files" description={app.versionName ? `Version ${app.versionName}` : undefined}>
          {app.wantsAndroid &&
            (app.downloadUrl ? (
              <a href={app.downloadUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <Download className="size-3.5" aria-hidden />
                Download the Android files
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">We’ll send you the Android files.</p>
            ))}
          {app.deliveryNote && <p className="whitespace-pre-line text-sm text-foreground">{app.deliveryNote}</p>}
          {app.stage === 'DELIVERED' && (
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              {app.wantsAndroid && <li>In your Google Play Console, create the app and upload the .aab file.</li>}
              {app.wantsIos && <li>In App Store Connect, the iPhone build is waiting — add the listing and submit it for review.</li>}
              <li>Use the listing pack we sent for the description, privacy answers and screenshots.</li>
              <li>Once it’s approved, tell us and we’ll switch on “Get our app” on your website.</li>
            </ol>
          )}
        </Card>
      )}

      {app.stage === 'LIVE' && (
        <Card title="In the stores">
          <div className="flex flex-wrap gap-2">
            {app.appStoreUrl && (
              <a href={app.appStoreUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                App Store <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
            {app.googlePlayUrl && (
              <a href={app.googlePlayUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Google Play <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
          <label className="flex items-start justify-between gap-4 text-sm">
            <span>
              <span className="font-medium text-foreground">Offer the app on your website</span>
              <span className="block text-xs text-muted-foreground">A “Get our app” banner on phones, a footer link, and a page with a QR code.</span>
            </span>
            <SwitchRoot
              checked={app.promoteOnWebsite}
              disabled={!data.canEdit}
              onCheckedChange={async (on) => {
                const r = await setAppPromotionAction(on);
                if (!r.success) return toast.error(r.error);
                toast.success(on ? 'Your website offers the app' : 'Your website no longer mentions the app');
                router.refresh();
              }}
            />
          </label>
        </Card>
      )}

      <Card title="Renewal" description={`${formatMoney(yearlyFee)} a year.`}>
        <p className="text-sm text-foreground">
          {app.paidThrough ? <>Paid until {formatDate(app.paidThrough)}.</> : 'Not paid yet.'}
        </p>
        {app.canRenew &&
          (data.canPay ? (
            <Button onClick={() => goToPayment('RENEWAL', setBusy)} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Renew for a year — {formatMoney(yearlyFee)}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Someone who manages billing can renew it.</p>
          ))}
        {app.payments.length > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {app.payments.map((p) => (
              <li key={`${p.kind}-${new Date(p.paidAt).toISOString()}`} className="flex justify-between gap-3 px-3 py-2">
                <span>
                  {p.kind === 'SETUP' ? 'Setup, first year included' : 'Yearly renewal'}
                  <span className="text-xs text-muted-foreground"> · {formatDate(p.paidAt)}</span>
                </span>
                <span className="tabular-nums">{formatMoney(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
