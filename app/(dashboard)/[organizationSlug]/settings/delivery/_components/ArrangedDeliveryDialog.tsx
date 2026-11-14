'use client';

/*
 * "Delivery to be arranged" for one store (ROADMAP 21.4B): a trade order too
 * big for a fixed price may be placed with delivery left open, and the store
 * prices it afterwards. Four fields, so a dialog.
 */
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
import { saveArrangedDelivery, type DeliveryStoreRow } from '@/features/settings/delivery';
import { ARRANGED_PRICE_HOURS } from '@/lib/storefront/orders/holds';
import { formatMoney } from '@/lib/format';

/** "From ₦500,000 or 100 items · priced within 24 hours" — for the store's row. */
export function arrangedSummary(arranged: DeliveryStoreRow['arranged']): string {
  if (!arranged.on) return 'Off';
  const from = [arranged.fromValue !== null ? formatMoney(arranged.fromValue) : null, arranged.fromItems !== null ? `${arranged.fromItems} items` : null]
    .filter(Boolean)
    .join(' or ');
  return `From ${from} · priced within ${arranged.priceHours} hours`;
}

export function ArrangedDeliveryDialog({
  open,
  onOpenChange,
  store,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: DeliveryStoreRow;
}) {
  const router = useRouter();
  const [on, setOn] = React.useState(store.arranged.on);
  const [fromValue, setFromValue] = React.useState(store.arranged.fromValue !== null ? String(store.arranged.fromValue) : '');
  const [fromItems, setFromItems] = React.useState(store.arranged.fromItems !== null ? String(store.arranged.fromItems) : '');
  const [priceHours, setPriceHours] = React.useState(String(store.arranged.priceHours));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    const result = await saveArrangedDelivery(store.id, {
      on,
      fromValue: fromValue.trim() === '' ? null : Number(fromValue.replace(/,/g, '')),
      fromItems: fromItems.trim() === '' ? null : Number(fromItems.replace(/,/g, '')),
      priceHours: Number(priceHours),
    });
    setPending(false);
    if (!result.success) {
      if (result.fieldErrors && Object.keys(result.fieldErrors).length) setErrors(result.fieldErrors);
      else setFormError(result.error);
      return;
    }
    toast.success(on ? 'Delivery to be arranged is on' : 'Delivery to be arranged is off');
    onOpenChange(false);
    router.refresh();
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Delivery to be arranged</DialogTitle>
            <DialogDescription>
              For trade orders from {store.name} too big for a fixed price — a truck, not a bike. The buyer orders the goods, you
              work out delivery and set the price, and they pay once they’ve seen it.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {formError && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            )}

            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div>
                <Label htmlFor="arranged-on">Offer it to trade buyers</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Shown at checkout beside your normal options, only to approved trade buyers and only for orders this size.
                </p>
              </div>
              <SwitchRoot id="arranged-on" checked={on} onCheckedChange={setOn} />
            </div>

            {on && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field>
                    <Label htmlFor="arranged-value">From an order of (₦)</Label>
                    <Input
                      id="arranged-value"
                      inputMode="decimal"
                      placeholder="e.g. 500000"
                      value={fromValue}
                      onChange={(e) => setFromValue(e.target.value)}
                      aria-invalid={errors.fromValue ? true : undefined}
                    />
                    {errors.fromValue && <FieldError>{errors.fromValue}</FieldError>}
                  </Field>
                  <Field>
                    <Label htmlFor="arranged-items">Or from (items)</Label>
                    <Input
                      id="arranged-items"
                      inputMode="numeric"
                      placeholder="e.g. 100"
                      value={fromItems}
                      onChange={(e) => setFromItems(e.target.value)}
                      aria-invalid={errors.fromItems ? true : undefined}
                    />
                    {errors.fromItems && <FieldError>{errors.fromItems}</FieldError>}
                  </Field>
                </div>
                <p className="-mt-2 text-xs text-muted-foreground">
                  Offered once the goods reach either one. Leave one blank to use only the other.
                </p>

                <Field>
                  <Label htmlFor="arranged-hours">You’ll price it within *</Label>
                  <SelectRoot value={priceHours} onValueChange={setPriceHours}>
                    <SelectTrigger id="arranged-hours" aria-invalid={errors.priceHours ? true : undefined}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ARRANGED_PRICE_HOURS.map((hours) => (
                        <SelectItem key={hours} value={String(hours)}>
                          {hours} hours
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </SelectRoot>
                  {errors.priceHours ? (
                    <FieldError>{errors.priceHours}</FieldError>
                  ) : (
                    <FieldDescription>
                      The buyer is told this. You’re reminded near the end; an order not priced by then is cancelled and its stock
                      released. Once priced, the buyer has 48 hours to accept.
                    </FieldDescription>
                  )}
                </Field>
              </>
            )}
          </div>

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
