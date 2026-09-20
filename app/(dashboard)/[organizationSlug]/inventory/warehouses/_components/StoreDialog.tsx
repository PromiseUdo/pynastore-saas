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
import type { WarehouseStatus } from '@/lib/generated/prisma/enums';

type StoreDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the store being edited; null = create */
  editing: WarehouseRow | null;
};

const STATUS_HELP: Record<WarehouseStatus, string> = {
  ACTIVE: 'In use: stock can move in and out.',
  INACTIVE: 'Closed: kept for its history, but it can’t sell online or take new stock.',
};

export function StoreDialog({ open, onOpenChange, editing }: StoreDialogProps) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [status, setStatus] = React.useState<WarehouseStatus>('ACTIVE');
  const [error, setError] = React.useState<string | null>(null);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setLocation(editing?.location ?? '');
    setStatus(editing?.status ?? 'ACTIVE');
    setError(null);
    setNameError(null);
  }, [open, editing]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Give the store a name.');
      return;
    }
    setNameError(null);
    setIsPending(true);
    setError(null);

    const input = { name: trimmed, location: location.trim() || undefined };
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

            <Field>
              <Label htmlFor="store-location">Address or area</Label>
              <Input
                id="store-location"
                placeholder="e.g. 14 Awolowo Road, Ikoyi"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
              <FieldDescription>Optional — helps your team tell stores apart.</FieldDescription>
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
