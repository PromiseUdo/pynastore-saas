'use client';

/* Add or edit a pickup location — six fields and a switch, so a dialog. */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SwitchRoot } from '@/components/ui/switch';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { NIGERIAN_STATES } from '@/lib/geo/nigeria';
import { savePickupLocation, type PickupLocationRow } from '@/features/settings/delivery';
import { ETA_UNITS, ETA_UNIT_LABELS, formatReady, fromMinutes, toMinutes, type DeliveryEtaUnit } from '@/lib/storefront/delivery/eta';

const UNIT_NOUN: Record<DeliveryEtaUnit, string> = { MINUTES: 'minutes', HOURS: 'hours', DAYS: 'working days' };

export function PickupDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: PickupLocationRow | null;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(editing?.name ?? '');
  const [address, setAddress] = React.useState(editing?.address ?? '');
  const [city, setCity] = React.useState(editing?.city ?? '');
  const [state, setState] = React.useState(editing?.state ?? '');
  const [readyUnit, setReadyUnit] = React.useState<DeliveryEtaUnit>(editing?.readyUnit ?? 'DAYS');
  const [readyTime, setReadyTime] = React.useState(editing ? String(fromMinutes(editing.readyMinutes, editing.readyUnit)) : '1');
  const [instructions, setInstructions] = React.useState(editing?.instructions ?? '');
  const [isActive, setIsActive] = React.useState(editing?.isActive ?? true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const minutes = toMinutes(Number(readyTime) || 0, readyUnit);
  const readyPreview = formatReady({ minMinutes: minutes, maxMinutes: minutes, unit: readyUnit });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    const result = await savePickupLocation(editing?.id ?? null, {
      name,
      address,
      city,
      state: state as (typeof NIGERIAN_STATES)[number],
      readyUnit,
      readyTime: Number(readyTime),
      instructions,
      isActive,
    });
    setPending(false);

    if (!result.success) {
      if (result.fieldErrors && Object.keys(result.fieldErrors).length) setErrors(result.fieldErrors);
      else setFormError(result.error);
      return;
    }
    toast.success(editing ? 'Pickup location updated' : 'Pickup location added');
    onOpenChange(false);
    router.refresh();
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit pickup location' : 'Add pickup location'}</DialogTitle>
            <DialogDescription>
              Customers anywhere can choose to collect their order here, for free.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {formError && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            )}

            <Field>
              <Label htmlFor="pickup-name">Name *</Label>
              <Input
                id="pickup-name"
                autoFocus
                placeholder="e.g. Main shop"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={errors.name ? true : undefined}
              />
              {errors.name && <FieldError>{errors.name}</FieldError>}
            </Field>

            <Field>
              <Label htmlFor="pickup-address">Street address *</Label>
              <Input
                id="pickup-address"
                placeholder="12 Aba Road"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                aria-invalid={errors.address ? true : undefined}
              />
              {errors.address && <FieldError>{errors.address}</FieldError>}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label htmlFor="pickup-city">City *</Label>
                <Input
                  id="pickup-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  aria-invalid={errors.city ? true : undefined}
                />
                {errors.city && <FieldError>{errors.city}</FieldError>}
              </Field>
              <Field>
                <Label htmlFor="pickup-state">State *</Label>
                <SelectRoot value={state} onValueChange={setState}>
                  <SelectTrigger id="pickup-state" aria-invalid={errors.state ? true : undefined}>
                    <SelectValue placeholder="Choose" />
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
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label htmlFor="pickup-ready-unit">Ready after *</Label>
                <SelectRoot value={readyUnit} onValueChange={(value) => setReadyUnit(value as DeliveryEtaUnit)}>
                  <SelectTrigger id="pickup-ready-unit" aria-invalid={errors.readyUnit ? true : undefined}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ETA_UNITS.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {ETA_UNIT_LABELS[unit]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
                {errors.readyUnit && <FieldError>{errors.readyUnit}</FieldError>}
              </Field>
              <Field>
                <Label htmlFor="pickup-ready">How many {UNIT_NOUN[readyUnit]} *</Label>
                <Input
                  id="pickup-ready"
                  inputMode="numeric"
                  value={readyTime}
                  onChange={(e) => setReadyTime(e.target.value)}
                  aria-invalid={errors.readyTime ? true : undefined}
                />
                {errors.readyTime && <FieldError>{errors.readyTime}</FieldError>}
              </Field>
            </div>
            <FieldDescription className="-mt-2">
              Use 0 if orders can be collected the same day. Customers see “{readyPreview}”.
            </FieldDescription>

            <Field>
              <Label htmlFor="pickup-instructions">Instructions for customers</Label>
              <Input
                id="pickup-instructions"
                placeholder="e.g. Open Mon–Sat, 9am–6pm. Ask at the counter."
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                aria-invalid={errors.instructions ? true : undefined}
              />
              {errors.instructions && <FieldError>{errors.instructions}</FieldError>}
            </Field>

            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div>
                <Label htmlFor="pickup-active">Offer at checkout</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">Turn off while this location is closed.</p>
              </div>
              <SwitchRoot id="pickup-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              {editing ? 'Save location' : 'Add location'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
