'use client';

/*
 * The shop wallet's PIN (ROADMAP 20.3): whether it's set, and — for someone
 * who can change settings — a dialog to create or change it. The vendor
 * enters it to send a refund (20.6) and to withdraw (20.7), so anyone who
 * does either needs it; change it when one of them leaves.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { KeyRound, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog';
import { changeShopPin, createShopPin } from '@/features/settings/shop-wallet';
import { formatDateTime } from '@/lib/format';
import type { PinFieldErrors } from '@/lib/wallet/pin';
import type { PinStatus } from '@/lib/wallet/edupay';

function PinInput({ id, label, error, value, onChange }: { id: string; label: string; error?: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field>
      <Label htmlFor={id}>{label} *</Label>
      <Input
        id={id}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        aria-invalid={error ? true : undefined}
        className="w-32 tracking-[0.5em] tabular-nums"
      />
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

export function ShopPinCard({ pin, canManage }: { pin: PinStatus; canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [currentPin, setCurrentPin] = React.useState('');
  const [newPin, setNewPin] = React.useState('');
  const [confirmPin, setConfirmPin] = React.useState('');
  const [errors, setErrors] = React.useState<PinFieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const changing = pin.isSet;

  function reset(next: boolean) {
    setOpen(next);
    // Nothing typed into a PIN field outlives the dialog.
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setErrors({});
    setFormError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = changing
      ? await changeShopPin({ currentPin, pin: newPin, confirmPin })
      : await createShopPin({ pin: newPin, confirmPin });
    setPending(false);
    if (!result.success) {
      setErrors(result.fieldErrors ?? {});
      setFormError(result.fieldErrors ? null : result.error);
      return;
    }
    toast.success(changing ? 'Wallet PIN changed' : 'Wallet PIN created');
    reset(false);
    router.refresh();
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">Wallet PIN</h2>
              {pin.isLocked ? (
                <Badge variant="destructive">Locked</Badge>
              ) : (
                <Badge variant={pin.isSet ? 'success' : 'draft'}>{pin.isSet ? 'Set' : 'Not set'}</Badge>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {pin.isLocked
                ? `Locked after too many wrong tries${pin.lockedUntil ? `, until ${formatDateTime(pin.lockedUntil)}` : ''}.`
                : pin.isSet
                  ? 'Needed to send refunds to customers’ wallets. Change it when someone who knows it leaves.'
                  : 'Create a 4-digit PIN. You’ll need it to send refunds to customers’ wallets.'}
            </p>
            {!canManage && !pin.isSet && (
              <p className="mt-1 text-xs text-muted-foreground">Ask someone who can change settings to create it.</p>
            )}
          </div>
        </div>
        {canManage && !pin.isLocked && (
          <Button size="sm" variant={pin.isSet ? 'outline' : 'default'} className="shrink-0 self-start" onClick={() => reset(true)}>
            {pin.isSet ? 'Change PIN' : 'Create PIN'}
          </Button>
        )}
      </div>

      <DialogRoot open={open} onOpenChange={reset}>
        <DialogContent>
          <form onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>{changing ? 'Change wallet PIN' : 'Create wallet PIN'}</DialogTitle>
              <DialogDescription>Four digits. Share it only with the people who send refunds or withdraw.</DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              {formError && (
                <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {formError}
                </p>
              )}
              {changing && <PinInput id="shop-pin-current" label="Current PIN" error={errors.currentPin} value={currentPin} onChange={setCurrentPin} />}
              <PinInput id="shop-pin-new" label="New PIN" error={errors.pin} value={newPin} onChange={setNewPin} />
              <PinInput id="shop-pin-confirm" label="Type the new PIN again" error={errors.confirmPin} value={confirmPin} onChange={setConfirmPin} />
              {!changing && <FieldDescription>Avoid easy ones like 1234 or 0000.</FieldDescription>}
            </div>
            <DialogFooter className="mt-6">
              <DialogClose asChild>
                <Button type="button" variant="outline" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={pending}>
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                {changing ? 'Change PIN' : 'Create PIN'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </DialogRoot>
    </section>
  );
}
