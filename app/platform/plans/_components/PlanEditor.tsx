'use client';

/*
 * The plan editor (ROADMAP 11.7): details, price with each cycle's result
 * shown before saving, features and limits — and, for a saved plan, whether
 * it's on sale. Checked with the same rules the server applies
 * (lib/billing/plan-edit.ts).
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckboxRoot } from '@/components/ui/checkbox';
import { SwitchRoot } from '@/components/ui/switch';
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
import { buttonVariants } from '@/components/ui/button-variants';
import { formatMoney, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CYCLES, FEATURE_INFO, type FeatureKey } from '@/lib/billing/plans';
import {
  SELLABLE_FEATURES,
  draftPrices,
  removedFeatures,
  validatePlanDraft,
  type PlanDraft,
  type PlanDraftErrors,
  type PlanDraftField,
} from '@/lib/billing/plan-edit';
import { createPlan, deletePlan, setPlanOnSale, updatePlan, type ConsolePlan } from '@/features/platform/plans';

/** What the inputs hold: numbers as typed, so a half-typed value isn't lost. */
interface FormState {
  name: string;
  tagline: string;
  monthlyPrice: string;
  biannualPct: string;
  yearlyPct: string;
  features: FeatureKey[];
  maxSeats: string;
  seatsUnlimited: boolean;
  maxWarehouses: string;
  storesUnlimited: boolean;
  highlighted: boolean;
}

const toNumber = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(/,/g, '')));

function fromDraft(d: PlanDraft): FormState {
  return {
    name: d.name,
    tagline: d.tagline,
    monthlyPrice: String(d.monthlyPrice),
    biannualPct: String(d.discounts.BIANNUAL),
    yearlyPct: String(d.discounts.YEARLY),
    features: d.features,
    maxSeats: d.maxSeats === null ? '' : String(d.maxSeats),
    seatsUnlimited: d.maxSeats === null,
    maxWarehouses: d.maxWarehouses === null ? '' : String(d.maxWarehouses),
    storesUnlimited: d.maxWarehouses === null,
    highlighted: d.highlighted,
  };
}

function toDraft(s: FormState): PlanDraft {
  return {
    name: s.name,
    tagline: s.tagline,
    monthlyPrice: toNumber(s.monthlyPrice),
    discounts: { BIANNUAL: toNumber(s.biannualPct), YEARLY: toNumber(s.yearlyPct) },
    features: s.features,
    maxSeats: s.seatsUnlimited ? null : toNumber(s.maxSeats),
    maxWarehouses: s.storesUnlimited ? null : toNumber(s.maxWarehouses),
    highlighted: s.highlighted,
  };
}

const NEW_PLAN: FormState = {
  name: '',
  tagline: '',
  monthlyPrice: '',
  biannualPct: '10',
  yearlyPct: '17',
  features: ['inventory.module', 'sales.module'],
  maxSeats: '5',
  seatsUnlimited: false,
  maxWarehouses: '1',
  storesUnlimited: false,
  highlighted: false,
};

export function PlanEditor({ plan }: { plan: ConsolePlan | null }) {
  const router = useRouter();
  const isNew = plan === null;
  const initial = React.useMemo(() => (plan ? fromDraft(plan.draft) : NEW_PLAN), [plan]);
  const [state, setState] = React.useState<FormState>(initial);
  const [errors, setErrors] = React.useState<PlanDraftErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [confirmRemoval, setConfirmRemoval] = React.useState(false);

  // A fresh plan from the server (after saving) resets the form.
  React.useEffect(() => setState(initial), [initial]);

  const dirty = JSON.stringify(state) !== JSON.stringify(initial);
  const draft = toDraft(state);
  const prices = draftPrices(draft);
  const removed = plan ? removedFeatures(plan.draft.features, state.features) : [];
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState((s) => ({ ...s, [key]: value }));

  async function save(confirmed = false) {
    setFormError(null);
    const checked = validatePlanDraft(draft);
    if (!checked.ok) {
      setErrors(checked.errors);
      setFormError('Check the highlighted fields.');
      return;
    }
    setErrors({});

    if (plan && removed.length && plan.workspaces > 0 && !confirmed) {
      setConfirmRemoval(true);
      return;
    }

    setSaving(true);
    if (isNew) {
      const result = await createPlan(checked.value);
      setSaving(false);
      if (!result.success) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      toast.success('Plan created. It’s off sale until you put it on sale.');
      router.push(`/platform/plans/${result.data.planId}`);
      return;
    }

    const result = await updatePlan(plan.id, checked.value, { confirmFeatureRemoval: confirmed });
    setSaving(false);
    setConfirmRemoval(false);
    if (!result.success) {
      if (result.needsConfirmation) {
        setConfirmRemoval(true);
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setFormError(result.error);
      return;
    }
    toast.success(
      result.data.pricesChanged
        ? 'Saved. The new price applies to new subscriptions and plan changes.'
        : 'Plan saved',
    );
    router.refresh();
  }

  const fieldError = (field: PlanDraftField) =>
    errors[field] ? (
      <p id={`${field}-error`} role="alert" className="text-xs font-medium text-destructive">
        {errors[field]}
      </p>
    ) : null;
  const invalid = (field: PlanDraftField) =>
    errors[field] ? { 'aria-invalid': true as const, 'aria-describedby': `${field}-error` } : {};

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="mx-auto max-w-3xl space-y-6"
    >
      {formError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}

      <Card title="Details" description="How the plan appears on the pricing page.">
        <div className="space-y-1.5">
          <Label htmlFor="name">
            Name <span className="text-destructive">*</span>
          </Label>
          <Input id="name" value={state.name} maxLength={40} onChange={(e) => set('name', e.target.value)} {...invalid('name')} />
          {fieldError('name')}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tagline">Tagline</Label>
          <Input
            id="tagline"
            value={state.tagline}
            maxLength={120}
            placeholder="For a shop just getting started"
            onChange={(e) => set('tagline', e.target.value)}
            {...invalid('tagline')}
          />
          <p className="text-xs text-muted-foreground">One line under the name — who the plan is for.</p>
          {fieldError('tagline')}
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="highlighted">Mark as popular</Label>
            <p className="text-xs text-muted-foreground">
              Shows a “Popular” badge and a border. Only one plan can have it; marking this one unmarks the others.
            </p>
          </div>
          <SwitchRoot id="highlighted" checked={state.highlighted} onCheckedChange={(v) => set('highlighted', v)} />
        </div>
      </Card>

      <Card title="Price" description="The monthly price, and how much less paying for longer costs.">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="monthlyPrice">
              Monthly price <span className="text-destructive">*</span>
            </Label>
            <Input
              id="monthlyPrice"
              inputMode="numeric"
              startAdornment={<span className="text-sm text-muted-foreground">₦</span>}
              value={state.monthlyPrice}
              onChange={(e) => set('monthlyPrice', e.target.value)}
              {...invalid('monthlyPrice')}
            />
            {fieldError('monthlyPrice')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="biannualPct">Discount every 6 months</Label>
            <Input
              id="biannualPct"
              inputMode="numeric"
              endAdornment={<span className="text-sm text-muted-foreground">%</span>}
              value={state.biannualPct}
              onChange={(e) => set('biannualPct', e.target.value)}
              {...invalid('discounts.BIANNUAL')}
            />
            {fieldError('discounts.BIANNUAL')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="yearlyPct">Discount yearly</Label>
            <Input
              id="yearlyPct"
              inputMode="numeric"
              endAdornment={<span className="text-sm text-muted-foreground">%</span>}
              value={state.yearlyPct}
              onChange={(e) => set('yearlyPct', e.target.value)}
              {...invalid('discounts.YEARLY')}
            />
            {fieldError('discounts.YEARLY')}
          </div>
        </div>

        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">What merchants will pay</caption>
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Paid
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Merchant pays
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Works out a month
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {prices.map((p) => {
                const ok = Number.isFinite(p.amount) && p.amount > 0;
                return (
                  <tr key={p.cycle}>
                    <td className="px-3 py-2">
                      {CYCLES[p.cycle].label}
                      {p.discountPct > 0 && <span className="text-xs text-muted-foreground"> · {p.discountPct}% off</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{ok ? formatMoney(p.amount) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {ok ? formatMoney(Math.round(p.amount / CYCLES[p.cycle].months)) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {plan && plan.paying > 0 && (
          <p className="text-xs text-muted-foreground">
            {formatNumber(plan.paying)} workspace{plan.paying === 1 ? ' pays' : 's pay'} for this plan now. A new price
            reaches new subscriptions and plan changes; they keep their current price until they change plan.
          </p>
        )}
      </Card>

      <Card title="Features" description="What the plan unlocks. Only features that exist can be sold.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {SELLABLE_FEATURES.map((f) => {
            const checked = state.features.includes(f);
            const losing = removed.includes(f);
            return (
              <li key={f} className="flex items-start gap-2.5">
                <CheckboxRoot
                  id={`feature-${f}`}
                  checked={checked}
                  onCheckedChange={(v) =>
                    set('features', v === true ? [...state.features, f] : state.features.filter((x) => x !== f))
                  }
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <Label htmlFor={`feature-${f}`} className="font-medium">
                    {FEATURE_INFO[f].label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{FEATURE_INFO[f].description}</p>
                  {losing && plan && plan.workspaces > 0 && (
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                      {formatNumber(plan.workspaces)} workspace{plan.workspaces === 1 ? '' : 's'} lose this when you save.
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {fieldError('features')}
      </Card>

      <Card
        title="Limits"
        description="Lowering a limit doesn’t remove members or stores a workspace already has — it stops them adding more."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <LimitField
            id="maxSeats"
            label="Team members"
            value={state.maxSeats}
            unlimited={state.seatsUnlimited}
            onValue={(v) => set('maxSeats', v)}
            onUnlimited={(v) => set('seatsUnlimited', v)}
            error={errors.maxSeats}
          />
          <LimitField
            id="maxWarehouses"
            label="Stores"
            value={state.maxWarehouses}
            unlimited={state.storesUnlimited}
            onValue={(v) => set('maxWarehouses', v)}
            onUnlimited={(v) => set('storesUnlimited', v)}
            error={errors.maxWarehouses}
          />
        </div>
      </Card>

      {plan && <SaleCard plan={plan} dirty={dirty} />}

      {(dirty || isNew) && (
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
          <p className="text-sm text-muted-foreground">{isNew ? 'This plan isn’t saved yet.' : 'You have unsaved changes.'}</p>
          <div className="flex items-center gap-2">
            {isNew ? (
              <Link href="/platform/plans" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                Cancel
              </Link>
            ) : (
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
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {isNew ? 'Create plan' : 'Save changes'}
            </Button>
          </div>
        </div>
      )}

      {plan && (
        <AlertDialogRoot open={confirmRemoval} onOpenChange={(open) => !saving && setConfirmRemoval(open)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Take features away from {plan.draft.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                {formatNumber(plan.workspaces)} workspace{plan.workspaces === 1 ? '' : 's'} on this plan will lose{' '}
                {removed.map((f) => FEATURE_INFO[f].label).join(', ')} the next time they open a page. Their data stays;
                the pages close until they’re on a plan that includes them.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={saving}>Keep them</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: 'destructive' })}
                disabled={saving}
                onClick={(e) => {
                  e.preventDefault();
                  void save(true);
                }}
              >
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                Remove and save
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogRoot>
      )}
    </form>
  );
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
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

function LimitField({
  id,
  label,
  value,
  unlimited,
  onValue,
  onUnlimited,
  error,
}: {
  id: string;
  label: string;
  value: string;
  unlimited: boolean;
  onValue: (v: string) => void;
  onUnlimited: (v: boolean) => void;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="numeric"
        value={unlimited ? '' : value}
        placeholder={unlimited ? 'Unlimited' : undefined}
        disabled={unlimited}
        onChange={(e) => onValue(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <CheckboxRoot checked={unlimited} onCheckedChange={(v) => onUnlimited(v === true)} />
        Unlimited
      </label>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** On sale or not, and deleting a plan that was never used. */
function SaleCard({ plan, dirty }: { plan: ConsolePlan; dirty: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<'sale' | 'delete' | null>(null);
  const [confirm, setConfirm] = React.useState<'retire' | 'delete' | null>(null);

  async function changeSale(onSale: boolean) {
    setPending('sale');
    const result = await setPlanOnSale(plan.id, onSale);
    setPending(null);
    setConfirm(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(onSale ? 'On sale — merchants can choose it now' : 'Taken off sale. Its subscribers keep it.');
    router.refresh();
  }

  async function remove() {
    setPending('delete');
    const result = await deletePlan(plan.id);
    setPending(null);
    if (!result.success) {
      setConfirm(null);
      toast.error(result.error);
      return;
    }
    toast.success('Plan deleted');
    router.push('/platform/plans');
  }

  return (
    <Card title="On sale" description="Whether merchants can choose this plan.">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 text-sm">
          <Badge variant={plan.isOnSale ? 'success' : 'muted'}>{plan.isOnSale ? 'On sale' : 'Off sale'}</Badge>
          <p className="text-xs text-muted-foreground">
            {plan.isOnSale
              ? 'Shown on the pricing page. Taking it off sale hides it from new merchants; workspaces on it keep it and keep renewing.'
              : 'Hidden from the pricing page. Workspaces already on it keep it and keep renewing.'}
            {plan.isTrialPlan && ' New workspaces get this plan as their free trial, so it has to stay on sale.'}
          </p>
          {dirty && <p className="text-xs text-muted-foreground">Save or discard your changes first.</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {plan.isOnSale ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={dirty || pending !== null || plan.isTrialPlan}
              onClick={() => setConfirm('retire')}
            >
              Take off sale
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={dirty || pending !== null} onClick={() => changeSale(true)}>
              {pending === 'sale' && <Loader2 className="size-3.5 animate-spin" />}
              Put on sale
            </Button>
          )}
          {plan.deletable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn('text-destructive hover:text-destructive')}
              disabled={pending !== null}
              onClick={() => setConfirm('delete')}
            >
              Delete plan
            </Button>
          )}
        </div>
      </div>

      <AlertDialogRoot open={confirm !== null} onOpenChange={(open) => !open && pending === null && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'delete' ? `Delete ${plan.draft.name}?` : `Take ${plan.draft.name} off sale?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'delete'
                ? 'Nobody has ever been on this plan, so nothing else changes. This can’t be undone.'
                : `New merchants won’t be able to choose it. ${
                    plan.workspaces > 0
                      ? `The ${formatNumber(plan.workspaces)} workspace${plan.workspaces === 1 ? '' : 's'} on it keep it, at their current price, until they change plan.`
                      : 'No workspace is on it.'
                  } You can put it back on sale at any time.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              disabled={pending !== null}
              onClick={(e) => {
                e.preventDefault();
                if (confirm === 'delete') void remove();
                else void changeSale(false);
              }}
            >
              {pending !== null && <Loader2 className="size-3.5 animate-spin" />}
              {confirm === 'delete' ? 'Delete plan' : 'Take off sale'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </Card>
  );
}
