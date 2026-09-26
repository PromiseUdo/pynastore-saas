'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { AlertDialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { formatNumber } from '@/lib/format';
import { removeProductFromStore, type StoreInventoryRow } from '@/features/inventory/actions';

/**
 * Stop a store carrying a product. The server refuses while there is stock,
 * anything held for an order, or any history at this store — this dialog says
 * which of those is in the way BEFORE asking, so the confirm button is only
 * offered when it will work (AGENTS §4).
 */
export function RemoveFromStoreDialog({
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
  const [isPending, setIsPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) setError(null);
  }, [open]);

  if (!row) return null;

  const name = `${row.name}${row.variantName ? ` · ${row.variantName}` : ''}`;
  const blocked = row.onHand !== 0 ? 'stock' : row.held !== 0 ? 'held' : null;

  async function remove() {
    if (!row) return;
    setIsPending(true);
    setError(null);
    const result = await removeProductFromStore({ warehouseId, inventoryItemId: row.itemId });
    setIsPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success(`${storeName} no longer carries ${name}`);
    router.refresh();
    onOpenChange(false);
  }

  return (
    <AlertDialogRoot open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {blocked ? `${name} can’t be removed yet` : `Stop ${storeName} carrying ${name}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {blocked === 'stock' ? (
              <>
                There {row.onHand === 1 ? 'is' : 'are'} still {formatNumber(row.onHand)} on the shelf here. Move them to another store, or
                count them out, and then remove the product.
              </>
            ) : blocked === 'held' ? (
              <>
                {formatNumber(row.held)} of these are held for a customer&apos;s order at this store. Finish or cancel that order first.
              </>
            ) : (
              <>
                This store stops carrying it, so it leaves this store&apos;s stock list. The product itself, its price and every other
                store keep everything — and you can add it back at any time. If it has ever moved through this store, the record stays at
                zero so the stock history still reads correctly.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{blocked ? 'Close' : 'Cancel'}</AlertDialogCancel>
          {!blocked && (
            <AlertDialog.Action asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={isPending}
                /* Radix closes on Action by default; the dialog has to stay open
                   long enough to show a refusal from the server. */
                onClick={(event) => {
                  event.preventDefault();
                  void remove();
                }}
              >
                {isPending && <Loader2 className="size-3.5 animate-spin" />}
                Remove from this store
              </Button>
            </AlertDialog.Action>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogRoot>
  );
}
