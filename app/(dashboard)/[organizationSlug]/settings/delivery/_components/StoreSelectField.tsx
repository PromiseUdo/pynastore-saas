'use client';

/*
 * "Which store do orders leave from?" — shared by the zone sheet and the
 * pickup dialog (ROADMAP Phase 9.2). Delivery belongs to a store because the
 * same address costs a different amount from each, so the store comes first
 * and is always required.
 */
import { Label } from '@/components/ui/label';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { formatStorePlace } from '@/features/inventory/store-place';
import type { DeliveryStoreRow } from '@/features/settings/delivery';

export function StoreSelectField({
  id,
  label,
  help,
  stores,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  help: string;
  stores: DeliveryStoreRow[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  // Closed stores can't send anything, but one already chosen stays visible.
  const choices = stores.filter((s) => s.open || s.id === value);

  return (
    <Field>
      <Label htmlFor={id}>{label} *</Label>
      <SelectRoot value={value} onValueChange={onChange}>
        <SelectTrigger id={id} aria-invalid={error ? true : undefined}>
          <SelectValue placeholder="Choose a store" />
        </SelectTrigger>
        <SelectContent>
          {choices.map((store) => {
            const place = formatStorePlace(store);
            const note = !store.open ? 'closed' : !store.sellsOnline ? 'not selling online' : null;
            return (
              <SelectItem key={store.id} value={store.id}>
                {store.name}
                {place && <span className="text-muted-foreground"> · {place}</span>}
                {note && <span className="text-muted-foreground"> ({note})</span>}
              </SelectItem>
            );
          })}
        </SelectContent>
      </SelectRoot>
      {error ? <FieldError>{error}</FieldError> : <FieldDescription>{help}</FieldDescription>}
    </Field>
  );
}
