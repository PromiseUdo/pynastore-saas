'use client';

/*
 * Create or edit a delivery zone.
 *
 * A Sheet rather than a dialog: choosing states is a long list. The three kinds
 * are explained in the merchant's terms, with the matching rule stated once —
 * a customer gets the most specific zone that covers them — so "Within Port
 * Harcourt" next to "Rivers" does what the merchant expects.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SwitchRoot } from '@/components/ui/switch';
import { CheckboxRoot } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { RadioGroup, RadioGroupCard } from '@/components/ui/radio-group';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { SheetRoot, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription, SheetClose } from '@/components/ui/sheet';
import { NIGERIAN_STATES } from '@/lib/geo/nigeria';
import { saveDeliveryZone, type DeliveryZoneRow } from '@/features/settings/delivery';

type Kind = DeliveryZoneRow['kind'];

const KINDS: { value: Kind; title: string; description: string }[] = [
  {
    value: 'CITIES',
    title: 'Cities or areas in one state',
    description: 'For local delivery, e.g. Port Harcourt, Obio-Akpor and Eleme in Rivers.',
  },
  { value: 'STATES', title: 'Whole states', description: 'e.g. Rivers, Bayelsa and Delta.' },
  {
    value: 'NATIONWIDE',
    title: 'Rest of Nigeria',
    description: 'Everywhere your other zones don’t cover. You can have one of these.',
  },
];

export function ZoneSheet({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: DeliveryZoneRow | null;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(editing?.name ?? '');
  const [kind, setKind] = React.useState<Kind>(editing?.kind ?? 'CITIES');
  const [state, setState] = React.useState(editing?.state ?? '');
  const [states, setStates] = React.useState<string[]>(editing?.states ?? []);
  const [cities, setCities] = React.useState((editing?.cities ?? []).join(', '));
  const [isActive, setIsActive] = React.useState(editing?.isActive ?? true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  function toggleState(value: string, checked: boolean) {
    setStates((current) => (checked ? [...current, value] : current.filter((s) => s !== value)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    const result = await saveDeliveryZone(editing?.id ?? null, {
      name,
      kind,
      state: kind === 'CITIES' ? (state as (typeof NIGERIAN_STATES)[number]) || null : null,
      states: kind === 'STATES' ? (states as (typeof NIGERIAN_STATES)[number][]) : [],
      cities: kind === 'CITIES' ? cities : [],
      isActive,
    });
    setPending(false);

    if (!result.success) {
      if (result.fieldErrors && Object.keys(result.fieldErrors).length) setErrors(result.fieldErrors);
      else setFormError(result.error);
      return;
    }
    toast.success(editing ? 'Zone updated' : 'Zone added — now add its delivery options');
    onOpenChange(false);
    router.refresh();
  }

  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-lg">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit delivery zone' : 'Add delivery zone'}</SheetTitle>
            <SheetDescription>
              A group of places you deliver to at the same prices. A customer gets the most specific zone that covers
              their address: a city zone beats a state zone, which beats “Rest of Nigeria”.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
            {formError && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            )}

            <Field>
              <Label htmlFor="zone-name">Zone name *</Label>
              <Input
                id="zone-name"
                autoFocus
                placeholder="e.g. Within Port Harcourt"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={errors.name ? true : undefined}
              />
              {errors.name ? (
                <FieldError>{errors.name}</FieldError>
              ) : (
                <FieldDescription>Customers see this at checkout, e.g. “Delivery to Within Port Harcourt”.</FieldDescription>
              )}
            </Field>

            <Field>
              <Label id="zone-kind-label">Covers *</Label>
              <RadioGroup value={kind} onValueChange={(v) => setKind(v as Kind)} aria-labelledby="zone-kind-label">
                {KINDS.map((option) => (
                  <RadioGroupCard key={option.value} value={option.value} id={`zone-kind-${option.value}`} className="p-3">
                    <span className="block text-sm font-medium">{option.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
                  </RadioGroupCard>
                ))}
              </RadioGroup>
              {errors.kind && <FieldError>{errors.kind}</FieldError>}
            </Field>

            {kind === 'CITIES' && (
              <>
                <Field>
                  <Label htmlFor="zone-state">State *</Label>
                  <SelectRoot value={state} onValueChange={setState}>
                    <SelectTrigger id="zone-state" aria-invalid={errors.state ? true : undefined}>
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
                  {errors.state && <FieldError>{errors.state}</FieldError>}
                </Field>

                <Field>
                  <Label htmlFor="zone-cities">Cities and areas *</Label>
                  <Textarea
                    id="zone-cities"
                    className="h-24"
                    placeholder="Port Harcourt, Obio-Akpor, Eleme"
                    value={cities}
                    onChange={(e) => setCities(e.target.value)}
                    aria-invalid={errors.cities ? true : undefined}
                  />
                  {errors.cities ? (
                    <FieldError>{errors.cities}</FieldError>
                  ) : (
                    <FieldDescription>
                      Separate with commas. Customers type their city at checkout, so add the names they’re likely to
                      use — capitals and spacing don’t matter.
                    </FieldDescription>
                  )}
                </Field>
              </>
            )}

            {kind === 'STATES' && (
              <Field>
                <div className="flex items-center justify-between">
                  <Label id="zone-states-label">States *</Label>
                  <span className="text-xs text-muted-foreground tabular-nums">{states.length} chosen</span>
                </div>
                <div
                  role="group"
                  aria-labelledby="zone-states-label"
                  className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border p-3"
                >
                  {NIGERIAN_STATES.map((s) => (
                    <label key={s} className="flex cursor-pointer items-center gap-2 text-sm">
                      <CheckboxRoot checked={states.includes(s)} onCheckedChange={(c) => toggleState(s, c === true)} />
                      {s}
                    </label>
                  ))}
                </div>
                {errors.states && <FieldError>{errors.states}</FieldError>}
              </Field>
            )}

            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div>
                <Label htmlFor="zone-active">Deliver to this zone</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Turn off to pause delivery here without losing its prices.
                </p>
              </div>
              <SwitchRoot id="zone-active" checked={isActive} onCheckedChange={setIsActive} />
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
              {editing ? 'Save zone' : 'Add zone'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </SheetRoot>
  );
}
