'use client';

/*
 * "Create your shop" (ROADMAP 12.5): name, web address (checked as they
 * type, with suggestions when taken), what they sell and where, and their
 * first store. The server re-checks everything (./actions.ts).
 */
import * as React from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckboxRoot } from '@/components/ui/checkbox';
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { NIGERIAN_STATES } from '@/lib/geo/nigeria';
import { getAdminUrl, getStorefrontUrl } from '@/lib/tenant/urls';
import { BUSINESS_TYPES, SALES_CHANNELS, isBusinessType, type BusinessType } from '@/lib/onboarding/business';
import { toShopAddress } from '@/lib/onboarding/shop-address';
import { checkShopAddress, createShop, type AddressCheck, type CreateShopField } from './actions';

const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

export function CreateShopForm({
  trial,
  isAnotherShop,
}: {
  trial: { days: number; planName: string } | null;
  isAnotherShop: boolean;
}) {
  const [name, setName] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [addressEdited, setAddressEdited] = React.useState(false);
  const [businessType, setBusinessType] = React.useState<BusinessType | ''>('');
  const [categories, setCategories] = React.useState<string[]>([]);
  const [channels, setChannels] = React.useState('');
  const [storeName, setStoreName] = React.useState('Main shop');
  const [state, setState] = React.useState('');
  const [city, setCity] = React.useState('');

  const [availability, setAvailability] = React.useState<AddressCheck | { status: 'checking' } | null>(null);
  const [errors, setErrors] = React.useState<Partial<Record<CreateShopField, string>>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const effectiveAddress = addressEdited ? toShopAddress(address) : toShopAddress(name);

  // Check the address as it settles.
  React.useEffect(() => {
    if (!effectiveAddress) {
      setAvailability(null);
      return;
    }
    setAvailability({ status: 'checking' });
    const timer = setTimeout(async () => {
      const result = await checkShopAddress({ address: effectiveAddress, city });
      if (result.status !== 'error') setAvailability(result);
      else setAvailability(null);
    }, 400);
    return () => clearTimeout(timer);
    // The city only shapes suggestions; don't recheck on every keystroke of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveAddress]);

  function chooseBusiness(value: string) {
    if (!isBusinessType(value)) return;
    setBusinessType(value);
    setCategories([]); // suggestions differ per type; nothing is pre-ticked
  }

  function applySuggestion(suggestion: string) {
    setAddress(suggestion);
    setAddressEdited(true);
    setErrors((e) => ({ ...e, address: undefined }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setPending(true);
    const result = await createShop({
      name,
      address: effectiveAddress,
      businessType,
      salesChannels: channels,
      categories,
      storeName,
      state,
      city,
    });
    if (!result.ok) {
      setPending(false);
      setErrors(result.fieldErrors ?? {});
      setFormError(result.error);
      if (result.suggestions) {
        setAvailability({ status: 'unavailable', address: effectiveAddress, message: result.fieldErrors?.address ?? '', suggestions: result.suggestions });
      }
      return;
    }
    // A different host (the shop's dashboard), so a full navigation.
    window.location.assign(result.adminUrl);
  }

  const suggestions = availability && availability.status === 'unavailable' ? availability.suggestions : [];
  const addressMessage = errors.address ?? (availability?.status === 'unavailable' ? availability.message : null);
  const err = (f: CreateShopField) =>
    errors[f] ? (
      <p id={`${f}-error`} role="alert" className="text-xs font-medium text-destructive">
        {errors[f]}
      </p>
    ) : null;
  const aria = (f: CreateShopField) => (errors[f] ? { 'aria-invalid': true as const, 'aria-describedby': `${f}-error` } : {});

  return (
    <form noValidate onSubmit={onSubmit} className="w-full max-w-xl space-y-6">
      <div className="text-center">
        <h1 className="text-xl font-semibold tracking-tight">{isAnotherShop ? 'Create another shop' : 'Create your shop'}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {trial
            ? `It takes a minute. You get a ${trial.days}-day free trial of ${trial.planName} — no card needed.`
            : 'It takes a minute. You’ll choose a plan once it’s created.'}
        </p>
      </div>

      {formError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}

      <Card title="Your shop">
        <div className="space-y-1.5">
          <Label htmlFor="name">
            Shop name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name"
            value={name}
            maxLength={60}
            placeholder="Ada’s Fabrics"
            autoComplete="organization"
            onChange={(e) => setName(e.target.value)}
            {...aria('name')}
          />
          {err('name')}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="address">
            Web address <span className="text-destructive">*</span>
          </Label>
          <Input
            id="address"
            value={addressEdited ? address : effectiveAddress}
            maxLength={40}
            placeholder="adas-fabrics"
            onChange={(e) => {
              setAddress(e.target.value.toLowerCase());
              setAddressEdited(true);
            }}
            aria-invalid={addressMessage ? true : undefined}
            aria-describedby="address-help"
            endAdornment={
              availability?.status === 'checking' ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Checking" />
              ) : availability?.status === 'available' ? (
                <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-label="Available" />
              ) : availability?.status === 'unavailable' ? (
                <X className="size-4 text-destructive" aria-label="Not available" />
              ) : null
            }
          />
          <div id="address-help" className="space-y-1">
            {addressMessage ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {addressMessage}
              </p>
            ) : null}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Available:</span>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => applySuggestion(s)}
                    className="rounded-md border bg-background px-2 py-1 font-mono text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {effectiveAddress && (
              <dl className="rounded-md bg-muted/50 px-3 py-2 text-xs">
                <div className="flex flex-wrap gap-x-1.5">
                  <dt className="text-muted-foreground">Your shop:</dt>
                  <dd className="font-mono text-foreground">{hostOf(getStorefrontUrl(effectiveAddress))}</dd>
                </div>
                <div className="flex flex-wrap gap-x-1.5">
                  <dt className="text-muted-foreground">Your dashboard:</dt>
                  <dd className="font-mono text-foreground">{hostOf(getAdminUrl(effectiveAddress, '/'))}</dd>
                </div>
              </dl>
            )}
            <p className="text-xs text-muted-foreground">
              This can’t be changed later, so links your customers save keep working. You can add your own domain,
              like yourshop.com, afterwards.
            </p>
          </div>
        </div>
      </Card>

      <Card title="What you sell" description="This only decides which setup steps we show first. You can sell anything.">
        <div className="space-y-1.5">
          <Label htmlFor="businessType">
            Your business <span className="text-destructive">*</span>
          </Label>
          <SelectRoot value={businessType} onValueChange={chooseBusiness}>
            <SelectTrigger id="businessType" {...aria('businessType')}>
              <SelectValue placeholder="Choose one" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(BUSINESS_TYPES) as BusinessType[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {BUSINESS_TYPES[key].label}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
          {err('businessType')}
        </div>

        {businessType && BUSINESS_TYPES[businessType].categories.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Start with some categories?</legend>
            <p className="text-xs text-muted-foreground">
              Tick any you want — they only sort your products, and you can rename or remove them later.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {BUSINESS_TYPES[businessType].categories.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <CheckboxRoot
                    checked={categories.includes(c)}
                    onCheckedChange={(v) => setCategories((list) => (v === true ? [...list, c] : list.filter((x) => x !== c)))}
                  />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">
            Where you sell <span className="text-destructive">*</span>
          </legend>
          <RadioGroupPrimitive.Root
            value={channels}
            onValueChange={setChannels}
            className="grid gap-2 sm:grid-cols-3"
            aria-describedby={errors.salesChannels ? 'salesChannels-error' : undefined}
          >
            {(Object.keys(SALES_CHANNELS) as (keyof typeof SALES_CHANNELS)[]).map((key) => (
              <label
                key={key}
                htmlFor={`channel-${key}`}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-md border bg-background p-3 text-sm transition-colors hover:bg-muted/50',
                  'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary',
                  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                )}
              >
                <RadioGroupPrimitive.Item
                  id={`channel-${key}`}
                  value={key}
                  className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-input focus-visible:outline-none"
                >
                  <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-primary" />
                </RadioGroupPrimitive.Item>
                <span>
                  <span className="block font-medium text-foreground">{SALES_CHANNELS[key].label}</span>
                  <span className="block text-xs text-muted-foreground">{SALES_CHANNELS[key].description}</span>
                </span>
              </label>
            ))}
          </RadioGroupPrimitive.Root>
          {err('salesChannels')}
        </fieldset>
      </Card>

      <Card title="Your first store" description="Where your stock is kept and sold from. You can add more stores later.">
        <div className="space-y-1.5">
          <Label htmlFor="storeName">
            Store name <span className="text-destructive">*</span>
          </Label>
          <Input id="storeName" value={storeName} maxLength={60} onChange={(e) => setStoreName(e.target.value)} {...aria('storeName')} />
          {err('storeName')}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="state">
              State <span className="text-destructive">*</span>
            </Label>
            <SelectRoot value={state} onValueChange={setState}>
              <SelectTrigger id="state" {...aria('state')}>
                <SelectValue placeholder="Choose a state" />
              </SelectTrigger>
              <SelectContent>
                {NIGERIAN_STATES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </SelectRoot>
            {err('state')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">
              City or town <span className="text-destructive">*</span>
            </Label>
            <Input id="city" value={city} maxLength={100} placeholder="Ikeja" onChange={(e) => setCity(e.target.value)} {...aria('city')} />
            {err('city')}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Delivery prices and times are worked out from where your stock leaves.</p>
      </Card>

      <div className="space-y-2">
        <Button type="submit" className="w-full" disabled={pending || availability?.status === 'checking'}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {pending ? 'Creating your shop…' : 'Create my shop'}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Your shop stays closed to customers, showing “Opening soon”, until you open it.
        </p>
      </div>
    </form>
  );
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="rounded-xl border bg-card shadow-sm">
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
