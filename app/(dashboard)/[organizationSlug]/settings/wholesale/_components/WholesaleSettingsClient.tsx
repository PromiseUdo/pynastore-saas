'use client';

/*
 * Settings → Wholesale (ROADMAP 21.1). Three choices, saved together:
 * whether the shop sells to trade buyers (and to anyone else), whether
 * shoppers may ask, and how trade buyers may pay.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRight, Loader2 } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { FieldDescription } from '@/components/ui/form-field';
import { SwitchRoot } from '@/components/ui/switch';
import { CheckboxRoot } from '@/components/ui/checkbox';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { PlanLockedNote } from '@/components/layout/plan-locked';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { WHOLESALE_MODES, type WholesaleMode } from '@/lib/trade/rules';
import { saveWholesaleSettings, type WholesaleSettingsInput } from '@/features/settings/wholesale';

const PAY_OPTIONS = [
  { key: 'tradePayOnline', label: 'Pay online', hint: 'Card, bank transfer or USSD through Paystack, before the order is sent.', offeredBy: 'online' },
  { key: 'tradePayTransfer', label: 'Bank transfer to you', hint: 'They transfer to your bank account; you confirm it.', offeredBy: 'transfer' },
  { key: 'tradePayOnDelivery', label: 'Pay on delivery', hint: 'They pay when the goods arrive.', offeredBy: 'onDelivery' },
] as const;

const NOT_OFFERED: Record<(typeof PAY_OPTIONS)[number]['offeredBy'], string> = {
  online: 'Your shop doesn’t take online payments yet (Settings → Payment setup).',
  transfer: 'Add a bank account in Settings → Payment setup to offer it.',
  onDelivery: 'Pay on delivery is turned off for your whole shop (Settings → Payment setup).',
};

export function WholesaleSettingsClient({
  initial,
  offered,
  buyers,
  waiting,
  canEdit: canEditSettings,
  vatRegistered,
  onPlan = true,
}: {
  initial: WholesaleSettingsInput;
  /** what the shop offers everyone today; trade choices can only narrow it */
  offered: { online: boolean; transfer: boolean; onDelivery: boolean };
  buyers: number;
  waiting: number;
  canEdit: boolean;
  /** VAT only exists for a registered shop (14.1); otherwise the choice is shown as not applying */
  vatRegistered: boolean;
  /** the plan includes Wholesale (22.1); without it wholesale is off and these settings wait */
  onPlan?: boolean;
}) {
  const router = useRouter();
  const canEdit = canEditSettings && onPlan;
  const [values, setValues] = React.useState<WholesaleSettingsInput>(initial);
  const [pending, setPending] = React.useState(false);
  // The minimum order as typed; saved as naira, blank = none.
  const [minOrder, setMinOrder] = React.useState(initial.minOrderValue ? String(initial.minOrderValue) : '');
  // Pay on account's default days (21.5), as typed.
  const [accountDays, setAccountDays] = React.useState(String(initial.accountDays));
  const [error, setError] = React.useState<string | null>(null);
  const dirty =
    JSON.stringify({ ...values, minOrderValue: null, accountDays: 0 }) !== JSON.stringify({ ...initial, minOrderValue: null, accountDays: 0 }) ||
    minOrder.replace(/,/g, '').trim() !== (initial.minOrderValue ? String(initial.minOrderValue) : '') ||
    accountDays.trim() !== String(initial.accountDays);
  const on = values.mode !== 'OFF';

  async function save() {
    const typed = minOrder.replace(/,/g, '').trim();
    const minOrderValue = typed ? Number(typed) : null;
    if (minOrderValue !== null && (!Number.isFinite(minOrderValue) || minOrderValue < 0)) {
      setError('Enter the minimum wholesale order as an amount, like 50000 — or leave it empty.');
      return;
    }
    const days = Number(accountDays.trim());
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setError('Enter the days to pay as a whole number from 1 to 365.');
      return;
    }
    setPending(true);
    setError(null);
    const result = await saveWholesaleSettings({ ...values, minOrderValue, accountDays: days });
    setPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success('Wholesale settings saved');
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Wholesale"
        description="Sell to other businesses on the same website, as wholesalers you approve."
        actions={
          <Link href="/sales/customers?segment=trade" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Wholesalers
            <ArrowRight className="size-3.5" />
          </Link>
        }
      />
      <PageBody className="max-w-3xl space-y-8">
        {!onPlan && (
          <PlanLockedNote feature="sales.wholesale">
            Wholesale isn’t on your plan, so it’s off: wholesalers see your usual prices and can’t ask for a wholesale account.
            Your settings and wholesalers are kept for when it’s back.
          </PlanLockedNote>
        )}
        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {on && (buyers > 0 || waiting > 0) && (
          <p className="text-sm text-muted-foreground">
            {formatNumber(buyers)} trade {buyers === 1 ? 'buyer' : 'buyers'}
            {waiting > 0 && (
              <>
                {' · '}
                <Link href="/sales/customers?segment=trade-requests" className="font-medium text-primary hover:underline">
                  {formatNumber(waiting)} {waiting === 1 ? 'request' : 'requests'} waiting
                </Link>
              </>
            )}
          </p>
        )}

        <section aria-labelledby="wholesale-mode" className="space-y-3">
          <div>
            <h2 id="wholesale-mode" className="text-sm font-semibold">
              Who can shop
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Wholesalers are businesses you approve. You manage them in Customers.
            </p>
          </div>
          <RadioGroupPrimitive.Root
            value={values.mode}
            onValueChange={(mode) => setValues((v) => ({ ...v, mode: mode as WholesaleMode }))}
            disabled={!canEdit}
            aria-labelledby="wholesale-mode"
            className="grid gap-2"
          >
            {WHOLESALE_MODES.map((mode) => (
              <label
                key={mode.value}
                htmlFor={`wholesale-${mode.value}`}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3.5 transition-colors hover:bg-muted/40',
                  'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary',
                  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                  !canEdit && 'cursor-not-allowed opacity-70',
                )}
              >
                <RadioGroupPrimitive.Item
                  id={`wholesale-${mode.value}`}
                  value={mode.value}
                  className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-input data-[state=checked]:border-primary focus-visible:outline-none"
                >
                  <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-primary" />
                </RadioGroupPrimitive.Item>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{mode.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{mode.hint}</span>
                </span>
              </label>
            ))}
          </RadioGroupPrimitive.Root>
        </section>

        {on && (
          <>
            <section aria-labelledby="wholesale-requests" className="space-y-3">
              <h2 id="wholesale-requests" className="text-sm font-semibold">
                New wholesalers
              </h2>
              <div className="flex items-start justify-between gap-4 rounded-lg border bg-card p-3.5">
                <div className="min-w-0">
                  <Label htmlFor="wholesale-requests-open">Let businesses ask for a wholesale account</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Adds a “Buy wholesale” page to your shop, where a signed-in shopper can send their business details. Each
                    request waits for you to approve or decline it. Off, only businesses you invite become wholesalers.
                  </p>
                </div>
                <SwitchRoot
                  id="wholesale-requests-open"
                  checked={values.requestsOpen}
                  onCheckedChange={(requestsOpen) => setValues((v) => ({ ...v, requestsOpen }))}
                  disabled={!canEdit}
                />
              </div>
            </section>

            <section aria-labelledby="wholesale-min-order" className="space-y-3">
              <h2 id="wholesale-min-order" className="text-sm font-semibold">
                Minimum wholesale order
              </h2>
              <div className="rounded-lg border bg-card p-3.5">
                <Label htmlFor="wholesale-min-order-value">Smallest wholesale order</Label>
                <Input
                  id="wholesale-min-order-value"
                  className="mt-1.5 max-w-48"
                  inputMode="decimal"
                  startAdornment={<span className="text-xs">₦</span>}
                  value={minOrder}
                  onChange={(e) => setMinOrder(e.target.value)}
                  placeholder="No minimum"
                  disabled={!canEdit}
                />
                <FieldDescription className="mt-1.5">
                  What a wholesaler’s goods must come to before they can check out — before any discount and delivery. Each
                  product’s own minimum and pack size are set on the product.
                </FieldDescription>
              </div>
            </section>

            <section aria-labelledby="wholesale-account" className="space-y-3">
              <h2 id="wholesale-account" className="text-sm font-semibold">
                Pay on account
              </h2>
              <div className="rounded-lg border bg-card p-3.5">
                <Label htmlFor="wholesale-account-days">Days to pay, to start with</Label>
                <Input
                  id="wholesale-account-days"
                  className="mt-1.5 max-w-32"
                  inputMode="numeric"
                  value={accountDays}
                  onChange={(e) => setAccountDays(e.target.value)}
                  disabled={!canEdit}
                />
                <FieldDescription className="mt-1.5">
                  Pay on account is off for every buyer until you give it to one, on their customer page — with their own days
                  to pay if you like, and an optional credit limit. This is the number they start with.
                </FieldDescription>
              </div>
            </section>

            <section aria-labelledby="wholesale-vat" className="space-y-3">
              <div>
                <h2 id="wholesale-vat" className="text-sm font-semibold">
                  Wholesale prices and VAT
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Your retail prices always include VAT. Many wholesalers quote wholesale prices before VAT instead.
                </p>
              </div>
              {vatRegistered ? (
                <RadioGroupPrimitive.Root
                  value={values.vatAdded ? 'added' : 'included'}
                  onValueChange={(choice) => setValues((v) => ({ ...v, vatAdded: choice === 'added' }))}
                  disabled={!canEdit}
                  aria-labelledby="wholesale-vat"
                  className="grid gap-2"
                >
                  {[
                    { value: 'included', label: 'My wholesale prices include VAT', hint: 'Like your retail prices: what wholesalers see is what they pay.' },
                    {
                      value: 'added',
                      label: 'VAT is added to my wholesale prices',
                      hint: 'Wholesalers see “+ VAT” beside every wholesale price, and VAT is added as its own line at checkout and on their receipt.',
                    },
                  ].map((choice) => (
                    <label
                      key={choice.value}
                      htmlFor={`wholesale-vat-${choice.value}`}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3.5 transition-colors hover:bg-muted/40',
                        'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary',
                        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                        !canEdit && 'cursor-not-allowed opacity-70',
                      )}
                    >
                      <RadioGroupPrimitive.Item
                        id={`wholesale-vat-${choice.value}`}
                        value={choice.value}
                        className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-input data-[state=checked]:border-primary focus-visible:outline-none"
                      >
                        <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-primary" />
                      </RadioGroupPrimitive.Item>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{choice.label}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{choice.hint}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroupPrimitive.Root>
              ) : (
                <p className="rounded-lg border bg-card p-3.5 text-sm text-muted-foreground">
                  Your shop isn’t VAT registered, so no VAT is charged on anything — wholesale included. If that changes, set it in{' '}
                  <Link href="/settings" className="font-medium text-primary hover:underline">
                    Settings → Business details
                  </Link>
                  .
                </p>
              )}
            </section>

            <section aria-labelledby="wholesale-pay" className="space-y-3">
              <div>
                <h2 id="wholesale-pay" className="text-sm font-semibold">
                  How wholesalers can pay
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  For example, turn off pay on delivery to have every wholesale order paid before it leaves. This only narrows
                  what your shop already offers.
                </p>
              </div>
              <div className="divide-y rounded-lg border bg-card">
                {PAY_OPTIONS.map((option) => {
                  const available = offered[option.offeredBy];
                  return (
                    <label
                      key={option.key}
                      htmlFor={`wholesale-${option.key}`}
                      className={cn('flex items-start gap-3 p-3.5', available && canEdit ? 'cursor-pointer' : 'cursor-not-allowed')}
                    >
                      <CheckboxRoot
                        id={`wholesale-${option.key}`}
                        className="mt-0.5"
                        checked={values[option.key]}
                        disabled={!canEdit}
                        onCheckedChange={(checked) => setValues((v) => ({ ...v, [option.key]: checked === true }))}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{option.label}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {available ? option.hint : NOT_OFFERED[option.offeredBy]}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {canEdit ? (
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={!dirty || pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Save wholesale settings
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Only someone who can change settings can change these.</p>
        )}
      </PageBody>
    </>
  );
}
