'use client';

/*
 * Settings → Delivery → "Orders from more than one store" (ROADMAP Phase 9.7).
 *
 * When no single store holds a customer's whole bag, the merchant chooses:
 * each store sends its own parcel (the default — quickest, each store charging
 * its own delivery), or the items are brought to one store and sent together
 * as one parcel, for a fee per store they come from and some extra time. The
 * customer sees whichever the merchant picked, priced accordingly, at checkout.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { RadioGroup, RadioGroupCard } from '@/components/ui/radio-group';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { saveConsolidationPolicy, type DeliverySettings } from '@/features/settings/delivery';
import { ETA_UNITS, ETA_UNIT_LABELS, fromMinutes, type DeliveryEtaUnit } from '@/lib/storefront/delivery/eta';

type Policy = DeliverySettings['consolidation'];

export function ConsolidationCard({ policy, canManage }: { policy: Policy; canManage: boolean }) {
  const router = useRouter();
  const [mode, setMode] = React.useState(policy.enabled ? 'together' : 'separate');
  const [fee, setFee] = React.useState(String(policy.fee));
  const [leadUnit, setLeadUnit] = React.useState<DeliveryEtaUnit>(policy.leadUnit);
  const [leadTime, setLeadTime] = React.useState(String(fromMinutes(policy.leadMinutes, policy.leadUnit)));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    const result = await saveConsolidationPolicy({
      enabled: mode === 'together',
      fee: fee.replace(/,/g, '') || '0',
      leadTime,
      leadUnit,
    });
    setPending(false);
    if (!result.success) {
      setErrors(result.fieldErrors ?? { form: result.error });
      return;
    }
    toast.success(
      mode === 'together'
        ? 'Orders from several stores will be brought together and sent as one parcel'
        : 'Each store will send its own parcel',
    );
    router.refresh();
  }

  return (
    <section id="split-orders" aria-labelledby="split-orders-heading" className="mt-8 border-t pt-6">
      <h2 id="split-orders-heading" className="text-sm font-semibold">
        Orders from more than one store
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        When no single store has everything in a customer’s bag, how should it reach them?
      </p>

      <form onSubmit={submit} noValidate className="mt-3 max-w-xl space-y-4 rounded-lg border bg-card p-4">
        {errors.form && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {errors.form}
          </p>
        )}

        <RadioGroup value={mode} onValueChange={setMode} aria-label="How orders from several stores are sent" disabled={!canManage}>
          <RadioGroupCard value="separate" id="split-separate" className="p-3">
            <span className="block text-sm font-medium">Each store sends its own parcel</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Quickest. The customer chooses delivery for each parcel and pays each store’s delivery.
            </span>
          </RadioGroupCard>
          <RadioGroupCard value="together" id="split-together" className="p-3">
            <span className="block text-sm font-medium">Bring it together and send one parcel</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Items are moved to the store that delivers to the customer — we raise the stock transfers once the order is
              confirmed — then sent as one parcel. Slower, and you set what it costs.
            </span>
          </RadioGroupCard>
        </RadioGroup>

        {mode === 'together' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="split-fee">Fee for each store items come from (₦) *</Label>
              <Input
                id="split-fee"
                inputMode="decimal"
                className="tabular-nums"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                disabled={!canManage}
                aria-invalid={errors.fee ? true : undefined}
              />
              {errors.fee ? (
                <FieldError>{errors.fee}</FieldError>
              ) : (
                <FieldDescription>Added to the delivery price. 0 if you’d rather cover it.</FieldDescription>
              )}
            </Field>
            <Field>
              <Label htmlFor="split-lead">Extra time to bring items over *</Label>
              <div className="flex gap-2">
                <Input
                  id="split-lead"
                  inputMode="numeric"
                  className="w-20 tabular-nums"
                  value={leadTime}
                  onChange={(e) => setLeadTime(e.target.value)}
                  disabled={!canManage}
                  aria-invalid={errors.leadTime ? true : undefined}
                />
                <SelectRoot value={leadUnit} onValueChange={(v) => setLeadUnit(v as DeliveryEtaUnit)} disabled={!canManage}>
                  <SelectTrigger aria-label="Unit" className="w-32">
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
              </div>
              {errors.leadTime ? (
                <FieldError>{errors.leadTime}</FieldError>
              ) : (
                <FieldDescription>Added to the delivery time customers are promised.</FieldDescription>
              )}
            </Field>
          </div>
        )}

        {canManage ? (
          <Button type="submit" size="sm" disabled={pending}>
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Save
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Ask an admin to change this.</p>
        )}
      </form>
    </section>
  );
}
