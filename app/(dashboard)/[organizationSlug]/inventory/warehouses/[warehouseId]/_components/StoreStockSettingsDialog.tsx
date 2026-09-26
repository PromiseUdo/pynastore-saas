'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { formatNumber } from '@/lib/format';
import { setStoreStockSettings, type StoreInventoryRow } from '@/features/inventory/actions';

/**
 * One product's settings AT THIS STORE: when to warn, how much to bring in,
 * and where it sits. Three fields, so a Dialog (AGENTS §4).
 *
 * An empty reorder point is not zero — it hands the decision back to the
 * product, which is what every store without an override already uses. The
 * form says so rather than leaving the merchant to guess.
 */
export function StoreStockSettingsDialog({
  open,
  onOpenChange,
  warehouseId,
  storeName,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
  storeName: string;
  row: StoreInventoryRow | null;
}) {
  const router = useRouter();
  const [reorderPoint, setReorderPoint] = React.useState('');
  const [reorderQty, setReorderQty] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (!open || !row) return;
    // Only this store's OWN override prefills — the product's value is a hint,
    // not something to silently copy into an override on save.
    setReorderPoint(row.reorderPointSource === 'store' && row.reorderPoint !== null ? String(row.reorderPoint) : '');
    setReorderQty(row.reorderQty !== null ? String(row.reorderQty) : '');
    setLocation(row.location ?? '');
    setFieldError(null);
    setError(null);
  }, [open, row]);

  if (!row) return null;

  const productThreshold = row.reorderPointSource === 'product' ? row.reorderPoint : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!row) return;

    const point = reorderPoint.trim() ? Number(reorderPoint) : null;
    const qty = reorderQty.trim() ? Number(reorderQty) : null;
    if ((point !== null && (!Number.isFinite(point) || point < 0)) || (qty !== null && (!Number.isFinite(qty) || qty <= 0))) {
      setFieldError('Enter whole numbers. A reorder point can be 0; a restock quantity must be more than 0.');
      return;
    }
    setFieldError(null);
    setIsPending(true);
    setError(null);

    const result = await setStoreStockSettings({
      warehouseId,
      inventoryItemId: row.itemId,
      reorderPoint: point,
      reorderQty: qty,
      location: location.trim() || null,
    });
    setIsPending(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success(`Saved ${row.name} at ${storeName}`);
    router.refresh();
    onOpenChange(false);
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {row.name}
              {row.variantName ? ` · ${row.variantName}` : ''}
            </DialogTitle>
            <DialogDescription>These settings apply at {storeName} only. Other stores keep their own.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Field>
              <Label htmlFor="store-reorder-point">Reorder point at this store</Label>
              <Input
                id="store-reorder-point"
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                autoFocus
                placeholder={productThreshold !== null ? `${formatNumber(productThreshold)} (from the product)` : 'None'}
                value={reorderPoint}
                onChange={(e) => setReorderPoint(e.target.value)}
                aria-invalid={Boolean(fieldError)}
              />
              <FieldDescription>
                When available stock here falls to this number, we alert you.{' '}
                {productThreshold !== null ? (
                  <>Leave it empty to use the product&apos;s own {formatNumber(productThreshold)} for this store.</>
                ) : (
                  <>The product sets none, so leaving it empty means nothing warns you when this runs low here.</>
                )}
              </FieldDescription>
            </Field>

            <Field>
              <Label htmlFor="store-reorder-qty">How much to bring in</Label>
              <Input
                id="store-reorder-qty"
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                placeholder="Optional"
                value={reorderQty}
                onChange={(e) => setReorderQty(e.target.value)}
              />
              <FieldDescription>Suggested on the restocking list when this store runs low.</FieldDescription>
            </Field>

            <Field>
              <Label htmlFor="store-shelf">Shelf or bin</Label>
              <Input
                id="store-shelf"
                placeholder="e.g. Aisle 4, Shelf B"
                maxLength={100}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
              <FieldDescription>Where to find it in this store, so pickers don&apos;t have to search.</FieldDescription>
            </Field>

            {fieldError && <FieldError>{fieldError}</FieldError>}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              Save settings
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
