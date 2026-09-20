'use client';

/*
 * Settings → Delivery and returns → Returns.
 *
 * One switch and one number. Whatever is saved here is what the storefront
 * promises ("Ask to return items within 14 days of delivery") and exactly
 * what the account page enforces when a customer asks — so the promise and
 * the rule can't drift. Off means no promise anywhere and no return button.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SwitchRoot } from '@/components/ui/switch';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { saveReturnPolicy } from '@/features/settings/delivery';

export function ReturnsPolicyCard({ returnWindowDays, canManage }: { returnWindowDays: number | null; canManage: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(returnWindowDays !== null);
  const [days, setDays] = React.useState(String(returnWindowDays ?? 14));
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const dirty = enabled !== (returnWindowDays !== null) || (enabled && Number(days) !== returnWindowDays);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await saveReturnPolicy({ enabled, days: Number(days) });
    setPending(false);
    if (!result.success) {
      setError(result.fieldErrors?.days ?? result.error);
      return;
    }
    toast.success(enabled ? `Customers can ask for a return within ${Number(days)} days of delivery` : 'Online returns turned off');
    router.refresh();
  }

  return (
    <section id="returns" aria-labelledby="returns-heading" className="mt-8 border-t pt-6">
      <h2 id="returns-heading" className="text-sm font-semibold">
        Returns
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Let customers ask to send items back from their account, for a set number of days after delivery. You approve or
        decline each request and record any refund in Sales → Returns. Customers can always cancel an order themselves
        until you start packing it.
      </p>

      <form onSubmit={submit} noValidate className="mt-3 max-w-xl space-y-4 rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="returns-enabled">Accept return requests online</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {enabled
                ? 'Product pages say how long customers have, and delivered orders show a “Return items” button.'
                : 'Off: your store makes no returns promise, and customers see no return button.'}
            </p>
          </div>
          <SwitchRoot id="returns-enabled" checked={enabled} onCheckedChange={setEnabled} disabled={!canManage} />
        </div>

        {enabled && (
          <Field>
            <Label htmlFor="returns-days">Days after delivery *</Label>
            <Input
              id="returns-days"
              inputMode="numeric"
              className="w-28 tabular-nums"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              disabled={!canManage}
              aria-invalid={error ? true : undefined}
            />
            {error ? (
              <FieldError>{error}</FieldError>
            ) : (
              <FieldDescription>
                Counted from the day you mark the order delivered. 7, 14 or 30 days are common.
              </FieldDescription>
            )}
          </Field>
        )}

        {canManage ? (
          <Button type="submit" size="sm" disabled={pending || !dirty}>
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Save returns policy
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Ask an admin to change your returns policy.</p>
        )}
      </form>
    </section>
  );
}
