'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { createWarehouse, updateWarehouse, type WarehouseRow } from '@/features/inventory/actions';
import { hasStorePlace, storePlaceProblem, type StorePlaceProblem } from '@/features/inventory/store-place';
import type { WarehouseStatus } from '@/lib/generated/prisma/enums';
import { NIGERIAN_STATES } from '@/lib/geo/nigeria';

type StoreDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the store being edited; null = create */
  editing: WarehouseRow | null;
};

/** Radix Select can't hold an empty value as an item, so "no state" is this. */
const NO_STATE = '__none';

const STATUS_HELP: Record<WarehouseStatus, string> = {
  ACTIVE: 'In use: stock can move in and out.',
  INACTIVE: 'Closed: kept for its history, but it can’t sell online or take new stock.',
};

export function StoreDialog({ open, onOpenChange, editing }: StoreDialogProps) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [state, setState] = React.useState('');
  const [city, setCity] = React.useState('');
  const [status, setStatus] = React.useState<WarehouseStatus>('ACTIVE');
  const [error, setError] = React.useState<string | null>(null);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [placeError, setPlaceError] = React.useState<StorePlaceProblem | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  /* The same rule the server applies: a store selling online keeps its place.
   * One that sold online before places existed isn't forced to add one just
   * to be renamed — the list and header ask for it instead. */
  const placeRequired = Boolean(editing?.sellsOnline && hasStorePlace(editing));

  React.useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setLocation(editing?.location ?? '');
    setState(editing?.state ?? '');
    setCity(editing?.city ?? '');
    setStatus(editing?.status ?? 'ACTIVE');
    setError(null);
    setNameError(null);
    setPlaceError(null);
  }, [open, editing]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    const problem = storePlaceProblem({ state, city }, placeRequired);
    setNameError(trimmed ? null : 'Give the store a name.');
    setPlaceError(problem);
    if (!trimmed || problem) return;
    setIsPending(true);
    setError(null);

    const input = {
      name: trimmed,
      location: location.trim() || undefined,
      state: state || null,
      city: city.trim() || null,
    };
    const result = editing ? await updateWarehouse(editing.id, { ...input, status }) : await createWarehouse(input);

    setIsPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success(editing ? `Saved “${trimmed}”` : `Added “${trimmed}”`);
    router.refresh();
    onOpenChange(false);
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit “${editing.name}”` : 'New store'}</DialogTitle>
            <DialogDescription>
              A store is anywhere you keep stock — a shop, a warehouse, even a van.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Field>
              <Label htmlFor="store-name">Name *</Label>
              <Input
                id="store-name"
                autoFocus
                placeholder="e.g. Lagos Store"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={Boolean(nameError)}
              />
              {nameError && <FieldError>{nameError}</FieldError>}
            </Field>

            <div className="space-y-1.5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field>
                  <Label htmlFor="store-city">City or town{placeRequired && ' *'}</Label>
                  <Input
                    id="store-city"
                    placeholder="e.g. Port Harcourt"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    aria-invalid={placeError?.field === 'city' ? true : undefined}
                  />
                  {placeError?.field === 'city' && <FieldError>{placeError.message}</FieldError>}
                </Field>
                <Field>
                  <Label htmlFor="store-state">State{placeRequired && ' *'}</Label>
                  <SelectRoot value={state} onValueChange={(v) => setState(v === NO_STATE ? '' : v)}>
                    <SelectTrigger id="store-state" aria-invalid={placeError?.field === 'state' ? true : undefined}>
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      {!placeRequired && <SelectItem value={NO_STATE}>Not set</SelectItem>}
                      {NIGERIAN_STATES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </SelectRoot>
                  {placeError?.field === 'state' && <FieldError>{placeError.message}</FieldError>}
                </Field>
              </div>
              <FieldDescription>
                {placeRequired
                  ? 'Delivery is priced from where orders leave, so a store that sells online needs this.'
                  : 'Needed before this store can sell online — delivery is priced from where orders leave.'}
              </FieldDescription>
            </div>

            <Field>
              <Label htmlFor="store-location">Street address</Label>
              <Input
                id="store-location"
                placeholder="e.g. 14 Awolowo Road, Ikoyi"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
              <FieldDescription>Optional — helps your team and riders find it.</FieldDescription>
            </Field>

            {editing && (
              <Field>
                <Label htmlFor="store-status">Status</Label>
                <SelectRoot value={status} onValueChange={(v) => setStatus(v as WarehouseStatus)}>
                  <SelectTrigger id="store-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Open</SelectItem>
                    <SelectItem value="INACTIVE">Closed</SelectItem>
                  </SelectContent>
                </SelectRoot>
                <FieldDescription>{STATUS_HELP[status]}</FieldDescription>
              </Field>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              {editing ? 'Save changes' : 'Add store'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
