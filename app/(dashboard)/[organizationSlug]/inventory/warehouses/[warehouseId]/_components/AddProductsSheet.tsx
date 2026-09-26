'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Package, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldDescription } from '@/components/ui/form-field';
import { SearchPicker } from '@/components/ui/search-picker';
import {
  SheetRoot,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/sheet';
import { formatNumber } from '@/lib/format';
import { assignProductsToStore, searchStoreCandidates, type StoreCandidateRow } from '@/features/inventory/actions';

type Picked = StoreCandidateRow & { quantity: string; unitCost: string };

/**
 * Stocking a store from the store's side (ROADMAP Phase 8.2): search the
 * catalogue, take several, and give each one an opening quantity if there is
 * already stock on the shelf. A line items form, so a Sheet rather than a
 * Dialog (AGENTS §4).
 */
export function AddProductsSheet({
  open,
  onOpenChange,
  warehouseId,
  storeName,
  canRecordStock,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
  storeName: string;
  canRecordStock: boolean;
}) {
  const router = useRouter();
  const [picked, setPicked] = React.useState<Picked[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setPicked([]);
    setError(null);
  }, [open]);

  const pickedIds = React.useMemo(() => new Set(picked.map((p) => p.itemId)), [picked]);

  function take(item: StoreCandidateRow) {
    if (pickedIds.has(item.itemId)) return;
    setPicked((rows) => [...rows, { ...item, quantity: '', unitCost: '' }]);
  }

  function setField(itemId: string, field: 'quantity' | 'unitCost', value: string) {
    setPicked((rows) => rows.map((row) => (row.itemId === itemId ? { ...row, [field]: value } : row)));
  }

  function drop(itemId: string) {
    setPicked((rows) => rows.filter((row) => row.itemId !== itemId));
  }

  async function submit() {
    setError(null);

    const lines = picked.map((row) => {
      const quantity = row.quantity.trim() ? Number(row.quantity) : undefined;
      const unitCost = row.unitCost.trim() ? Number(row.unitCost) : undefined;
      return { inventoryItemId: row.itemId, quantity, unitCost };
    });

    const bad = lines.find(
      (line) =>
        (line.quantity !== undefined && (!Number.isFinite(line.quantity) || line.quantity < 0)) ||
        (line.unitCost !== undefined && (!Number.isFinite(line.unitCost) || line.unitCost < 0)),
    );
    if (bad) {
      setError('Quantities and costs must be numbers, and can’t be negative.');
      return;
    }

    setIsPending(true);
    const result = await assignProductsToStore({ warehouseId, lines });
    setIsPending(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    const { added, withOpeningStock, alreadyStocked } = result.data;
    if (added === 0) {
      toast.info(`${storeName} already carries ${alreadyStocked === 1 ? 'that product' : 'those products'}.`);
    } else {
      toast.success(
        `${formatNumber(added)} product${added === 1 ? '' : 's'} added to ${storeName}` +
          (withOpeningStock > 0 ? `, ${formatNumber(withOpeningStock)} with opening stock` : ''),
      );
    }
    router.refresh();
    onOpenChange(false);
  }

  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Add products to {storeName}</SheetTitle>
          <SheetDescription>
            Choose what this store carries. Leave a quantity empty if there is none on the shelf yet — the product still appears in this
            store&apos;s stock list, ready to receive stock.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 overflow-y-auto px-4 pb-4">
          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div>
            <Label htmlFor="store-add-search">Find a product</Label>
            <SearchPicker
              id="store-add-search"
              label="Search products to add to this store"
              placeholder="Search by name, SKU or barcode…"
              autoFocus
              onSearch={(q) => searchStoreCandidates({ warehouseId, q })}
              onPick={take}
              getKey={(item) => item.itemId}
              isDisabled={(item) => pickedIds.has(item.itemId)}
              emptyHint={`Nothing matched — or this store already carries it.`}
              renderItem={(item) => (
                <>
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">{item.name}</span>
                    {item.variantName && <Badge variant="muted">{item.variantName}</Badge>}
                    {item.status !== 'ACTIVE' && <Badge variant="warning">Discontinued</Badge>}
                  </span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {item.sku}
                    <span className="font-sans">
                      {' · '}
                      {item.otherStoreCount === 0
                        ? 'not stocked anywhere yet'
                        : `${formatNumber(item.availableElsewhere)} available in ${formatNumber(item.otherStoreCount)} other store${item.otherStoreCount === 1 ? '' : 's'}`}
                    </span>
                  </span>
                </>
              )}
            />
            <FieldDescription>Products with options are listed by option, because stock is counted per option.</FieldDescription>
          </div>

          {picked.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
              <Package className="size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nothing chosen yet. Search above and pick what {storeName} carries.</p>
            </div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {picked.map((row) => (
                <li key={row.itemId} className="space-y-2 px-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {row.name}
                        {row.variantName && <span className="text-muted-foreground"> · {row.variantName}</span>}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">{row.sku}</p>
                    </div>
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${row.name}`} onClick={() => drop(row.itemId)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  {canRecordStock && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label htmlFor={`qty-${row.itemId}`} className="text-xs">
                          Opening stock
                        </Label>
                        <Input
                          id={`qty-${row.itemId}`}
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          placeholder="0"
                          value={row.quantity}
                          onChange={(e) => setField(row.itemId, 'quantity', e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`cost-${row.itemId}`} className="text-xs">
                          Cost per unit
                        </Label>
                        <Input
                          id={`cost-${row.itemId}`}
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          placeholder="Optional"
                          value={row.unitCost}
                          onChange={(e) => setField(row.itemId, 'unitCost', e.target.value)}
                          disabled={!row.quantity.trim()}
                        />
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {picked.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {canRecordStock
                ? 'A quantity is recorded as stock arriving at this store, so it appears in the stock movements with today’s date. The cost keeps your average cost honest — leave it out if you don’t know it.'
                : 'You can add products to this store, but not record stock. Someone who can record movements will need to add the quantities.'}
            </p>
          )}
        </div>

        <SheetFooter>
          <SheetClose asChild>
            <Button type="button" variant="outline" size="sm" disabled={isPending}>
              Cancel
            </Button>
          </SheetClose>
          <Button type="button" size="sm" onClick={() => void submit()} disabled={isPending || picked.length === 0}>
            {isPending && <Loader2 className="size-3.5 animate-spin" />}
            {picked.length <= 1 ? 'Add product' : `Add ${picked.length} products`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </SheetRoot>
  );
}
