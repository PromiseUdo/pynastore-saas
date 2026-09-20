'use client';

/*
 * Create or edit a discount code.
 *
 * A Sheet rather than a Dialog: there are more than six fields, and most of
 * them are limits a merchant wants to see together before switching a code
 * on. Everything except the code, what it gives and its name is optional —
 * a code with nothing else set simply works for everyone, forever.
 *
 * Server errors come back per field and land beside their own field; what
 * the merchant typed is never thrown away.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field, FieldDescription, FieldError, FormSection } from '@/components/ui/form-field';
import { RadioGroup, RadioGroupCard } from '@/components/ui/radio-group';
import { SwitchRoot } from '@/components/ui/switch';
import {
  SheetRoot,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/sheet';
import { saveDiscountCode, type DiscountCodeRow } from '@/features/sales/discounts';

type Kind = 'PERCENT' | 'FIXED';

const KINDS: { value: Kind; title: string; description: string }[] = [
  { value: 'PERCENT', title: 'A percentage off', description: 'e.g. 10% off whatever the order comes to.' },
  { value: 'FIXED', title: 'An amount off', description: 'e.g. ₦5,000 off — usually with a minimum spend.' },
];

/** A `datetime-local` value from an ISO string, in the browser's own zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function DiscountSheet({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: DiscountCodeRow | null;
}) {
  const router = useRouter();
  const [code, setCode] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [kind, setKind] = React.useState<Kind>('PERCENT');
  const [value, setValue] = React.useState('');
  const [minSubtotal, setMinSubtotal] = React.useState('');
  const [startsAt, setStartsAt] = React.useState('');
  const [endsAt, setEndsAt] = React.useState('');
  const [usageLimit, setUsageLimit] = React.useState('');
  const [perCustomerLimit, setPerCustomerLimit] = React.useState('');
  const [isActive, setIsActive] = React.useState(true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setCode(editing?.code ?? '');
    setLabel(editing?.label ?? '');
    setKind(editing?.kind ?? 'PERCENT');
    setValue(editing ? String(editing.value) : '');
    setMinSubtotal(editing?.minSubtotal != null ? String(editing.minSubtotal) : '');
    setStartsAt(toLocalInput(editing?.startsAt ?? null));
    setEndsAt(toLocalInput(editing?.endsAt ?? null));
    setUsageLimit(editing?.usageLimit != null ? String(editing.usageLimit) : '');
    setPerCustomerLimit(editing?.perCustomerLimit != null ? String(editing.perCustomerLimit) : '');
    setIsActive(editing?.isActive ?? true);
    setErrors({});
    setFormError(null);
  }, [open, editing]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);

    const result = await saveDiscountCode(editing?.id ?? null, {
      code,
      label,
      kind,
      value,
      minSubtotal,
      startsAt,
      endsAt,
      usageLimit,
      perCustomerLimit,
      isActive,
    });
    setPending(false);

    if (!result.success) {
      setErrors(result.fieldErrors ?? {});
      setFormError(result.fieldErrors ? null : result.error);
      return;
    }

    toast.success(editing ? `Saved ${code.toUpperCase()}` : `${code.toUpperCase()} is ready to use`);
    router.refresh();
    onOpenChange(false);
  }

  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-lg">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>{editing ? `Edit ${editing.code}` : 'New discount code'}</SheetTitle>
            <SheetDescription>
              Customers type this at checkout to take money off their order. It applies to the goods only, never to
              delivery.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-4 py-4">
            {formError && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            )}

            <FormSection title="The code">
              <Field>
                <Label htmlFor="discount-code">Code *</Label>
                <Input
                  id="discount-code"
                  autoFocus
                  className="font-mono uppercase"
                  placeholder="e.g. WELCOME10"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  aria-invalid={errors.code ? true : undefined}
                />
                {errors.code ? (
                  <FieldError>{errors.code}</FieldError>
                ) : (
                  <FieldDescription>
                    What the customer types. Capitals and spaces don&rsquo;t matter — we match either way.
                  </FieldDescription>
                )}
              </Field>

              <Field>
                <Label htmlFor="discount-label">What it gives *</Label>
                <Input
                  id="discount-label"
                  placeholder="e.g. 10% off your first order"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  aria-invalid={errors.label ? true : undefined}
                />
                {errors.label ? (
                  <FieldError>{errors.label}</FieldError>
                ) : (
                  <FieldDescription>Shown to the customer once they&rsquo;ve applied the code.</FieldDescription>
                )}
              </Field>
            </FormSection>

            <FormSection title="What it takes off">
              <Field>
                <Label id="discount-kind-label">Type *</Label>
                <RadioGroup value={kind} onValueChange={(v) => setKind(v as Kind)} aria-labelledby="discount-kind-label">
                  {KINDS.map((option) => (
                    <RadioGroupCard key={option.value} value={option.value} id={`discount-kind-${option.value}`} className="p-3">
                      <span className="block text-sm font-medium">{option.title}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
                    </RadioGroupCard>
                  ))}
                </RadioGroup>
              </Field>

              <Field>
                <Label htmlFor="discount-value">{kind === 'PERCENT' ? 'Percentage off (%) *' : 'Amount off (₦) *'}</Label>
                <Input
                  id="discount-value"
                  type="number"
                  inputMode="decimal"
                  min={kind === 'PERCENT' ? 1 : 0}
                  max={kind === 'PERCENT' ? 100 : undefined}
                  step={kind === 'PERCENT' ? 1 : 100}
                  placeholder={kind === 'PERCENT' ? '10' : '5000'}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  aria-invalid={errors.value ? true : undefined}
                />
                {errors.value ? (
                  <FieldError>{errors.value}</FieldError>
                ) : (
                  <FieldDescription>
                    {kind === 'PERCENT'
                      ? 'Taken off the goods in the order, before delivery.'
                      : 'Never more than the order is worth — a ₦5,000 code on a ₦3,000 order takes off ₦3,000.'}
                  </FieldDescription>
                )}
              </Field>

              <Field>
                <Label htmlFor="discount-min">Minimum spend (₦)</Label>
                <Input
                  id="discount-min"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={100}
                  placeholder="Any amount"
                  value={minSubtotal}
                  onChange={(e) => setMinSubtotal(e.target.value)}
                  aria-invalid={errors.minSubtotal ? true : undefined}
                />
                {errors.minSubtotal ? (
                  <FieldError>{errors.minSubtotal}</FieldError>
                ) : (
                  <FieldDescription>
                    The goods must come to at least this much. Leave empty for no minimum.
                  </FieldDescription>
                )}
              </Field>
            </FormSection>

            <FormSection title="When it runs">
              <Field>
                <Label htmlFor="discount-starts">Starts</Label>
                <Input
                  id="discount-starts"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  aria-invalid={errors.startsAt ? true : undefined}
                />
                {errors.startsAt ? (
                  <FieldError>{errors.startsAt}</FieldError>
                ) : (
                  <FieldDescription>Leave empty to start straight away.</FieldDescription>
                )}
              </Field>

              <Field>
                <Label htmlFor="discount-ends">Ends</Label>
                <Input
                  id="discount-ends"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  aria-invalid={errors.endsAt ? true : undefined}
                />
                {errors.endsAt ? (
                  <FieldError>{errors.endsAt}</FieldError>
                ) : (
                  <FieldDescription>Leave empty and it runs until you switch it off.</FieldDescription>
                )}
              </Field>
            </FormSection>

            <FormSection title="How many can use it">
              <Field>
                <Label htmlFor="discount-limit">Total uses</Label>
                <Input
                  id="discount-limit"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  placeholder="Unlimited"
                  value={usageLimit}
                  onChange={(e) => setUsageLimit(e.target.value)}
                  aria-invalid={errors.usageLimit ? true : undefined}
                />
                {errors.usageLimit ? (
                  <FieldError>{errors.usageLimit}</FieldError>
                ) : (
                  <FieldDescription>
                    Across all customers. Once it&rsquo;s reached, the code stops working.
                    {editing && editing.usageCount > 0 && ` Used ${editing.usageCount} time${editing.usageCount === 1 ? '' : 's'} so far.`}
                  </FieldDescription>
                )}
              </Field>

              <Field>
                <Label htmlFor="discount-per-customer">Uses per customer</Label>
                <Input
                  id="discount-per-customer"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  placeholder="Unlimited"
                  value={perCustomerLimit}
                  onChange={(e) => setPerCustomerLimit(e.target.value)}
                  aria-invalid={errors.perCustomerLimit ? true : undefined}
                />
                {errors.perCustomerLimit ? (
                  <FieldError>{errors.perCustomerLimit}</FieldError>
                ) : (
                  <FieldDescription>
                    Set to 1 for a one-per-person code. Counted by customer, so a guest is matched on their email
                    address.
                  </FieldDescription>
                )}
              </Field>
            </FormSection>

            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div>
                <Label htmlFor="discount-active">Code is on</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Turn off to stop it working immediately, without losing its settings or its history.
                </p>
              </div>
              <SwitchRoot id="discount-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          <SheetFooter>
            <SheetClose asChild>
              <Button type="button" variant="outline" size="sm">
                Cancel
              </Button>
            </SheetClose>
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              {editing ? 'Save code' : 'Create code'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </SheetRoot>
  );
}
