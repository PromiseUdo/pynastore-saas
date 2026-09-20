'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field, FieldDescription } from '@/components/ui/form-field';
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
import { formatNumber } from '@/lib/format';
import { getProductStockUnits, recordStockIn, type ProductStockUnits, type WarehouseRow } from '@/features/inventory/actions';

type AddStockDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string | null;
  warehouses: WarehouseRow[];
  /**
   * 'opening' is the first-run version, shown right after a product is
   * created: same entry, different framing ("how many do you have already").
   */
  mode?: 'add' | 'opening';
};

export function AddStockDialog({ open, onOpenChange, productId, warehouses, mode = 'add' }: AddStockDialogProps) {
  const router = useRouter();
  const openStores = React.useMemo(() => warehouses.filter((w) => w.status === 'ACTIVE'), [warehouses]);

  const [units, setUnits] = React.useState<ProductStockUnits | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [warehouseId, setWarehouseId] = React.useState<string>('');
  const [quantities, setQuantities] = React.useState<Record<string, string>>({});
  const [cost, setCost] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open || !productId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQuantities({});
    setCost('');
    // Preselect the only store, or the one the website sells from.
    setWarehouseId(openStores.length === 1 ? openStores[0].id : (openStores.find((w) => w.sellsOnline)?.id ?? ''));
    getProductStockUnits(productId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setUnits(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, productId, openStores]);

  const lines = Object.entries(quantities)
    .map(([inventoryItemId, value]) => ({ inventoryItemId, quantity: Number(value.trim()) }))
    .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0);
  const totalUnits = lines.reduce((sum, l) => sum + l.quantity, 0);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!warehouseId) {
      setError('Choose which store this stock is in.');
      return;
    }
    if (lines.length === 0) {
      setError('Enter how many you have for at least one line.');
      return;
    }
    const costValue = cost.trim() ? Number(cost.replace(/,/g, '')) : undefined;
    if (costValue !== undefined && (!Number.isFinite(costValue) || costValue < 0)) {
      setError('Enter a cost like 17000, or leave it blank.');
      return;
    }

    setSaving(true);
    const result = await recordStockIn({
      warehouseId,
      notes: mode === 'opening' ? 'Opening stock' : undefined,
      lines: lines.map((l) => ({ ...l, unitCost: costValue })),
    });
    setSaving(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    const storeName = openStores.find((w) => w.id === warehouseId)?.name ?? 'the store';
    toast.success(`Added ${formatNumber(totalUnits)} ${units?.unit ?? 'units'} to ${storeName}`);
    router.refresh();
    onOpenChange(false);
  }

  const noStores = openStores.length === 0;

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{mode === 'opening' ? 'How much do you have already?' : 'Add stock'}</DialogTitle>
            <DialogDescription>
              {mode === 'opening'
                ? 'Enter what’s on the shelf today and we’ll record it as your starting stock. You can skip this and do it later.'
                : 'Record stock arriving at a store. It’s added to the ledger, so you can always see where a number came from.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            {noStores ? (
              <p className="text-sm text-muted-foreground">
                You need a store before you can hold stock.{' '}
                <Link href="/inventory/warehouses" className="font-medium text-primary hover:underline">
                  Add a store
                </Link>
              </p>
            ) : loading || !units ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading…
              </p>
            ) : (
              <>
                <Field>
                  <Label htmlFor="stock-store">Store *</Label>
                  <SelectRoot value={warehouseId} onValueChange={setWarehouseId}>
                    <SelectTrigger id="stock-store">
                      <SelectValue placeholder="Choose a store" />
                    </SelectTrigger>
                    <SelectContent>
                      {openStores.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </SelectRoot>
                  <FieldDescription>Stock is counted per store, so pick where these are.</FieldDescription>
                </Field>

                <div className="space-y-1.5">
                  <Label>{units.hasVariants ? 'How many of each?' : 'How many?'}</Label>
                  <ul className="divide-y rounded-md border">
                    {units.units.map((unit) => {
                      const already = warehouseId
                        ? (unit.byStore.find((s) => s.warehouseId === warehouseId)?.quantity ?? 0)
                        : 0;
                      return (
                        <li key={unit.id} className="flex items-center justify-between gap-3 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{unit.label}</p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {unit.sku}
                              {already !== 0 && (
                                <span className="ml-2 font-sans">{formatNumber(already)} already here</span>
                              )}
                            </p>
                          </div>
                          <Input
                            aria-label={`Quantity for ${unit.label}`}
                            inputMode="numeric"
                            className="h-8 w-28 text-right"
                            placeholder="0"
                            value={quantities[unit.id] ?? ''}
                            onChange={(e) => setQuantities((prev) => ({ ...prev, [unit.id]: e.target.value }))}
                          />
                        </li>
                      );
                    })}
                  </ul>
                  {units.hasVariants && (
                    <FieldDescription>Each size or colour is counted separately. Leave a line blank to skip it.</FieldDescription>
                  )}
                </div>

                <Field>
                  <Label htmlFor="stock-cost">Cost per unit</Label>
                  <Input
                    id="stock-cost"
                    inputMode="decimal"
                    startAdornment={<span className="text-xs">₦</span>}
                    placeholder="Optional"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                  />
                  <FieldDescription>
                    What you paid per unit. Used for your stock value and profit reports — leave blank if you’re not sure.
                  </FieldDescription>
                </Field>

                {lines.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Adding {formatNumber(totalUnits)} {units.unit} in total.
                  </p>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm">
                {mode === 'opening' ? 'Skip for now' : 'Cancel'}
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={saving || loading || noStores}>
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {mode === 'opening' ? 'Save opening stock' : 'Add stock'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
