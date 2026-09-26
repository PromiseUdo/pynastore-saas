'use client';

/* Add or edit one delivery option within a zone — six fields, so a dialog. */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SwitchRoot } from '@/components/ui/switch';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { saveDeliveryRate, type DeliveryRateRow } from '@/features/settings/delivery';
import { ETA_UNITS, ETA_UNIT_LABELS, formatEta, fromMinutes, toMinutes, type DeliveryEtaUnit } from '@/lib/storefront/delivery/eta';

/* What each unit means for the two number boxes, in the merchant's words. */
const UNIT_HINT: Record<DeliveryEtaUnit, string> = {
  MINUTES: 'Minutes from when you dispatch. Use 30 and 45 for a rider who is there within the hour.',
  HOURS: 'Hours from when you dispatch. Same-day orders usually sit here.',
  DAYS: 'Working days from dispatch, weekends skipped. Use 0 and 0 for same-day delivery.',
};
const UNIT_NOUN: Record<DeliveryEtaUnit, string> = { MINUTES: 'minutes', HOURS: 'hours', DAYS: 'days' };

export function RateDialog({
  open,
  onOpenChange,
  zone,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zone: { id: string; name: string } | null;
  editing: DeliveryRateRow | null;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(editing?.name ?? 'Standard');
  const [price, setPrice] = React.useState(editing ? String(editing.price) : '');
  const [etaUnit, setEtaUnit] = React.useState<DeliveryEtaUnit>(editing?.etaUnit ?? 'DAYS');
  const [minTime, setMinTime] = React.useState(editing ? String(fromMinutes(editing.minMinutes, editing.etaUnit)) : '1');
  const [maxTime, setMaxTime] = React.useState(editing ? String(fromMinutes(editing.maxMinutes, editing.etaUnit)) : '3');
  const [freeOver, setFreeOver] = React.useState(editing?.freeOver != null ? String(editing.freeOver) : '');
  const [isActive, setIsActive] = React.useState(editing?.isActive ?? true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  /* Exactly the sentence checkout will show, so there are no surprises. */
  const preview = formatEta({
    minMinutes: toMinutes(Number(minTime) || 0, etaUnit),
    maxMinutes: toMinutes(Number(maxTime) || 0, etaUnit),
    unit: etaUnit,
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!zone) return;
    setPending(true);
    setErrors({});
    setFormError(null);
    const result = await saveDeliveryRate(zone.id, editing?.id ?? null, {
      name,
      price: price.trim() === '' ? Number.NaN : Number(price.replace(/,/g, '')),
      etaUnit,
      minTime: Number(minTime),
      maxTime: Number(maxTime),
      freeOver: freeOver.trim() === '' ? null : Number(freeOver.replace(/,/g, '')),
      isActive,
    });
    setPending(false);

    if (!result.success) {
      if (result.fieldErrors && Object.keys(result.fieldErrors).length) setErrors(result.fieldErrors);
      else setFormError(result.error);
      return;
    }
    toast.success(editing ? 'Delivery option updated' : 'Delivery option added');
    onOpenChange(false);
    router.refresh();
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit delivery option' : 'Add delivery option'}</DialogTitle>
            <DialogDescription>For customers in {zone?.name ?? 'this zone'}.</DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {formError && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            )}

            <Field>
              <Label htmlFor="rate-name">Name *</Label>
              <Input
                id="rate-name"
                autoFocus
                placeholder="e.g. Standard, Same day"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={errors.name ? true : undefined}
              />
              {errors.name && <FieldError>{errors.name}</FieldError>}
            </Field>

            <Field>
              <Label htmlFor="rate-price">Price (₦) *</Label>
              <Input
                id="rate-price"
                inputMode="decimal"
                placeholder="2500"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                aria-invalid={errors.price ? true : undefined}
              />
              {errors.price ? <FieldError>{errors.price}</FieldError> : <FieldDescription>Enter 0 for free delivery.</FieldDescription>}
            </Field>

            <Field>
              <Label htmlFor="rate-unit">Delivery time is measured in *</Label>
              <SelectRoot value={etaUnit} onValueChange={(value) => setEtaUnit(value as DeliveryEtaUnit)}>
                <SelectTrigger id="rate-unit" aria-invalid={errors.etaUnit ? true : undefined}>
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
              {errors.etaUnit && <FieldError>{errors.etaUnit}</FieldError>}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label htmlFor="rate-min">Fastest ({UNIT_NOUN[etaUnit]}) *</Label>
                <Input
                  id="rate-min"
                  inputMode="numeric"
                  value={minTime}
                  onChange={(e) => setMinTime(e.target.value)}
                  aria-invalid={errors.minTime ? true : undefined}
                />
                {errors.minTime && <FieldError>{errors.minTime}</FieldError>}
              </Field>
              <Field>
                <Label htmlFor="rate-max">Slowest ({UNIT_NOUN[etaUnit]}) *</Label>
                <Input
                  id="rate-max"
                  inputMode="numeric"
                  value={maxTime}
                  onChange={(e) => setMaxTime(e.target.value)}
                  aria-invalid={errors.maxTime ? true : undefined}
                />
                {errors.maxTime && <FieldError>{errors.maxTime}</FieldError>}
              </Field>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              {UNIT_HINT[etaUnit]} Customers see “{preview}”.
            </p>

            <Field>
              <Label htmlFor="rate-free">Free delivery over (₦)</Label>
              <Input
                id="rate-free"
                inputMode="decimal"
                placeholder="Leave blank to always charge"
                value={freeOver}
                onChange={(e) => setFreeOver(e.target.value)}
                aria-invalid={errors.freeOver ? true : undefined}
              />
              {errors.freeOver ? (
                <FieldError>{errors.freeOver}</FieldError>
              ) : (
                <FieldDescription>When the items in an order come to at least this much, this option is free.</FieldDescription>
              )}
            </Field>

            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div>
                <Label htmlFor="rate-active">Offer at checkout</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">Turn off to hide this option without deleting it.</p>
              </div>
              <SwitchRoot id="rate-active" checked={isActive} onCheckedChange={setIsActive} />
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
              {editing ? 'Save option' : 'Add option'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
