'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatMoney } from '@/lib/format';
import {
  updateBillingSettings,
  type BillingSettingsInput,
  type ConsoleBillingSettings,
} from '@/features/platform/billing-settings';

type Field = keyof BillingSettingsInput;

export function BillingSettingsForm({ settings }: { settings: ConsoleBillingSettings }) {
  const router = useRouter();
  const initial = React.useMemo(
    () => ({
      trialDays: String(settings.trialDays),
      trialPlanId: settings.trialPlanId,
      graceDays: String(settings.graceDays),
      usdToNgnRate: String(settings.usdToNgnRate),
      mobileAppSetupFee: settings.mobileAppSetupFee === null ? '' : String(settings.mobileAppSetupFee),
      mobileAppYearlyFee: settings.mobileAppYearlyFee === null ? '' : String(settings.mobileAppYearlyFee),
      mobileAppGraceDays: String(settings.mobileAppGraceDays),
    }),
    [settings],
  );
  const [state, setState] = React.useState(initial);
  const [errors, setErrors] = React.useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setState(initial), [initial]);

  const dirty = JSON.stringify(state) !== JSON.stringify(initial);
  const set = (key: Field, value: string) => setState((s) => ({ ...s, [key]: value }));
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(/,/g, '')));
  const trialDays = num(state.trialDays);
  const noTrial = trialDays === 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    const result = await updateBillingSettings({
      trialDays: num(state.trialDays),
      trialPlanId: state.trialPlanId,
      graceDays: num(state.graceDays),
      usdToNgnRate: num(state.usdToNgnRate),
      // Empty = the add-on isn't on sale.
      mobileAppSetupFee: state.mobileAppSetupFee.trim() === '' ? null : num(state.mobileAppSetupFee),
      mobileAppYearlyFee: state.mobileAppYearlyFee.trim() === '' ? null : num(state.mobileAppYearlyFee),
      mobileAppGraceDays: num(state.mobileAppGraceDays),
    });
    setSaving(false);
    if (!result.success) {
      setErrors(result.fieldErrors ?? {});
      setFormError(result.error);
      return;
    }
    setErrors({});
    toast.success(result.data.changed.length ? 'Billing settings saved' : 'Nothing had changed');
    router.refresh();
  }

  const err = (f: Field) =>
    errors[f] ? (
      <p id={`${f}-error`} role="alert" className="text-xs font-medium text-destructive">
        {errors[f]}
      </p>
    ) : null;
  const aria = (f: Field) => (errors[f] ? { 'aria-invalid': true as const, 'aria-describedby': `${f}-error` } : {});

  return (
    <form noValidate onSubmit={onSubmit} className="mx-auto max-w-2xl space-y-6">
      {formError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}

      <Section title="Free trial" description="What a new workspace gets when it signs up. No card is taken.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="trialDays">
              Length in days <span className="text-destructive">*</span>
            </Label>
            <Input id="trialDays" inputMode="numeric" value={state.trialDays} onChange={(e) => set('trialDays', e.target.value)} {...aria('trialDays')} />
            <p className="text-xs text-muted-foreground">0 means no trial: new workspaces go straight to choosing a plan.</p>
            {err('trialDays')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trialPlanId">Plan it gives {!noTrial && <span className="text-destructive">*</span>}</Label>
            <SelectRoot value={state.trialPlanId} onValueChange={(v) => set('trialPlanId', v)} disabled={noTrial}>
              <SelectTrigger id="trialPlanId" {...aria('trialPlanId')}>
                <SelectValue placeholder="Choose a plan" />
              </SelectTrigger>
              <SelectContent>
                {settings.plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </SelectRoot>
            <p className="text-xs text-muted-foreground">Only plans on sale can be given.</p>
            {settings.trialPlanMissing && !noTrial && (
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                The saved trial plan isn’t on sale, so new workspaces aren’t getting a trial. Choose one.
              </p>
            )}
            {err('trialPlanId')}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Changes apply to workspaces created from now on. A trial already running keeps its end date.
        </p>
      </Section>

      <Section
        title="Grace period"
        description="When a trial or plan ends without payment, the shop keeps taking orders for this long, with a countdown in the merchant's dashboard. After it, the shop shows a closed page."
      >
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="graceDays">
            Days <span className="text-destructive">*</span>
          </Label>
          <Input id="graceDays" inputMode="numeric" value={state.graceDays} onChange={(e) => set('graceDays', e.target.value)} {...aria('graceDays')} />
          <p className="text-xs text-muted-foreground">0 closes the shop the moment the plan ends.</p>
          {err('graceDays')}
        </div>
        <p className="text-xs text-muted-foreground">
          Changes apply to plans that end from now on. A shop already in its grace period keeps the deadline it was given.
        </p>
      </Section>

      <Section title="Exchange rate" description="Used to price domain registrations, which are bought in US dollars.">
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="usdToNgnRate">
            Naira per US dollar <span className="text-destructive">*</span>
          </Label>
          <Input
            id="usdToNgnRate"
            inputMode="decimal"
            startAdornment={<span className="text-sm text-muted-foreground">₦</span>}
            value={state.usdToNgnRate}
            onChange={(e) => set('usdToNgnRate', e.target.value)}
            {...aria('usdToNgnRate')}
          />
          {Number.isFinite(num(state.usdToNgnRate)) && num(state.usdToNgnRate) > 0 && (
            <p className="text-xs text-muted-foreground tabular-nums">
              A $10 domain costs merchants {formatMoney(Math.round(num(state.usdToNgnRate) * 10))}.
            </p>
          )}
          {err('usdToNgnRate')}
        </div>
      </Section>

      <Section
        title="Store apps"
        description="The add-on that gives a store its own Android and iPhone app. Leave both fees empty to keep it off sale."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          {(
            [
              ['mobileAppSetupFee', 'Setup fee', 'Paid once, when the merchant asks for the app. Includes the first year.'],
              ['mobileAppYearlyFee', 'Yearly fee', 'Each year after the first.'],
            ] as const
          ).map(([field, label, help]) => (
            <div key={field} className="space-y-1.5">
              <Label htmlFor={field}>{label}</Label>
              <Input
                id={field}
                inputMode="decimal"
                startAdornment={<span className="text-sm text-muted-foreground">₦</span>}
                value={state[field]}
                onChange={(e) => set(field, e.target.value)}
                {...aria(field)}
              />
              <p className="text-xs text-muted-foreground">{help}</p>
              {err(field)}
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="mobileAppGraceDays">
              Grace days <span className="text-destructive">*</span>
            </Label>
            <Input
              id="mobileAppGraceDays"
              inputMode="numeric"
              value={state.mobileAppGraceDays}
              onChange={(e) => set('mobileAppGraceDays', e.target.value)}
              {...aria('mobileAppGraceDays')}
            />
            <p className="text-xs text-muted-foreground">After a year runs out unpaid, the app keeps working this long.</p>
            {err('mobileAppGraceDays')}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          New prices apply to the next payment. A merchant who already paid keeps what they paid for.
        </p>
      </Section>

      <div className="flex justify-end gap-2">
        {dirty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setState(initial);
              setErrors({});
              setFormError(null);
            }}
          >
            Discard
          </Button>
        )}
        <Button type="submit" size="sm" disabled={saving || !dirty}>
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Save settings
        </Button>
      </div>
    </form>
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
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}
