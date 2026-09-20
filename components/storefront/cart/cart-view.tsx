'use client';

/*
 * /cart — the bag in full.
 *
 * The only client component on the page, because the bag lives in the
 * browser (lib/storefront/stores/cart-store.ts) and the server has no
 * opinion about it. It renders a skeleton until the store has rehydrated
 * rather than rendering an empty bag it might have to take back: "your bag
 * is empty" flashing at someone who has six things in it is worse than a
 * beat of nothing.
 *
 * Lines left, summary right, stacking to one column on a phone. The summary
 * is sticky on desktop only — a fixed bar on mobile would sit on top of the
 * last line, which is exactly the thing a shopper is trying to read.
 */
import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialogRoot,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { CartLineItem } from './cart-line-item';
import { OrderSummary } from './order-summary';
import { EmptyCart } from './empty-cart';
import { AssistantLauncher } from '@/components/storefront/assistant/assistant-launcher';
import { Recommendations } from '@/components/storefront/recommendations/recommendations';
import { useCartStore } from '@/lib/storefront/stores/cart-store';
import { useCartReconciliation } from '@/lib/storefront/use-cart-reconciliation';
import { describeNotice, lineKey } from '@/lib/storefront/cart';
import { formatMoney } from '@/lib/storefront/format';
import { computeTotals } from '@/lib/storefront/pricing';

export function CartView() {
  const hydrated = useCartStore((s) => s.hydrated);
  const items = useCartStore((s) => s.items);
  const savedForLater = useCartStore((s) => s.savedForLater);
  const coupon = useCartStore((s) => s.coupon);
  const count = useCartStore((s) => s.count());

  /* Derived here rather than through a store selector: `computeTotals`
   * returns a fresh object, and a selector that returns a new object every
   * call re-renders forever under zustand's snapshot checks. The numbers
   * still come from exactly one place (lib/storefront/pricing.ts). */
  const totals = React.useMemo(() => computeTotals({ items, coupon }), [items, coupon]);

  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const saveForLater = useCartStore((s) => s.saveForLater);
  const moveToCart = useCartStore((s) => s.moveToCart);
  const removeSaved = useCartStore((s) => s.removeSaved);
  const clear = useCartStore((s) => s.clear);

  const { notices } = useCartReconciliation();

  /* Removal is one tap and one toast with an undo, not a dialog: a
   * confirmation on every remove is a tax on the common case. Clearing the
   * whole bag does ask (below), because that one cannot be shrugged off. */
  const onRemove = (key: string) => {
    const item = useCartStore.getState().getItem(key);
    if (!item) return;
    removeItem(key);
    const { quantity, addedAt: _addedAt, ...line } = item;
    toast('Removed from your bag', {
      description: item.name,
      action: {
        label: 'Undo',
        onClick: () => useCartStore.getState().addItem(line, quantity),
      },
    });
  };

  const onClear = () => {
    const previous = useCartStore.getState().items;
    clear();
    toast('Bag cleared', {
      action: {
        label: 'Undo',
        onClick: () => useCartStore.setState({ items: previous }),
      },
    });
  };

  if (!hydrated) return <CartSkeleton />;

  if (items.length === 0) {
    return (
      <div className="mt-6 space-y-10">
        <EmptyCart />
        {savedForLater.length > 0 && (
          <SavedForLater items={savedForLater} onMove={moveToCart} onRemove={removeSaved} />
        )}
      </div>
    );
  }

  return (
    <>
      <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-10">
        <div className="min-w-0">
          {notices.length > 0 && (
            <div
              role="status"
              className="mb-5 rounded-xl border border-sale/30 bg-sale/5 p-4 text-sm text-foreground"
            >
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="size-4 text-sale" aria-hidden />
                Some things changed while your bag was waiting
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-6 text-muted-foreground">
                {notices.map((notice) => (
                  <li key={`${notice.kind}:${notice.key}`}>{describeNotice(notice)}</li>
                ))}
              </ul>
            </div>
          )}

          <ul className="divide-y">
            {items.map((item) => (
              <CartLineItem
                key={lineKey(item)}
                item={item}
                onQuantityChange={updateQuantity}
                onRemove={onRemove}
                onSaveForLater={saveForLater}
              />
            ))}
          </ul>

          {/* Quiet, and nowhere near Checkout. */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t pt-5">
            <Link
              href="/products"
              className="text-sm font-medium text-muted-foreground hover:text-brand"
            >
              ← Continue shopping
            </Link>

            {/* The bag's own ids are the context — the assistant re-reads the
             * rows itself, so nothing about these products is sent up (§10). */}
            <AssistantLauncher
              variant="link"
              label="Need help choosing another item?"
              seed={{
                surface: 'cart',
                cartProductIds: items.map((item) => item.productId),
              }}
            />

            <AlertDialogRoot>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-4" aria-hidden /> Clear bag
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear your bag?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes all {items.length} item
                    {items.length === 1 ? '' : 's'} from your bag. Anything you want to keep, save
                    for later first.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep my bag</AlertDialogCancel>
                  <AlertDialogAction onClick={onClear}>Clear bag</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialogRoot>
          </div>

          {savedForLater.length > 0 && (
            <div className="mt-10">
              <SavedForLater items={savedForLater} onMove={moveToCart} onRemove={removeSaved} />
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-24">
          <OrderSummary totals={totals} itemCount={count} discountLabel={coupon?.label} />
        </div>
      </div>

      {/* Below the whole bag — on a phone that means after the summary and its
       * checkout button, so a suggestion never stands between a shopper and
       * paying (§15). The bag's own ids reach the service as signals; saved
       * items are already the shopper's, so they aren't suggested back. */}
      <Recommendations
        id="complete-your-order"
        placement="cart"
        exclude={savedForLater.map((item) => item.productId)}
      />
    </>
  );
}

/* ---------------- saved for later ---------------- */

function SavedForLater({
  items,
  onMove,
  onRemove,
}: {
  items: ReturnType<typeof useCartStore.getState>['savedForLater'];
  onMove: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <section aria-labelledby="saved-heading" className="border-t pt-8">
      <h2 id="saved-heading" className="font-display text-lg">
        Saved for later ({items.length})
      </h2>
      <ul className="mt-4 divide-y">
        {items.map((item) => {
          const key = lineKey(item);
          const label = item.optionSummary ? `${item.name} (${item.optionSummary})` : item.name;
          return (
            <li key={key} className="flex items-center gap-4 py-4">
              <Image
                src={item.imageUrl}
                alt=""
                width={64}
                height={80}
                className="h-20 w-16 rounded-lg bg-tile object-cover"
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/products/${item.productSlug}`}
                  className="line-clamp-1 text-sm font-medium hover:text-brand"
                >
                  {item.name}
                </Link>
                {item.optionSummary && (
                  <p className="text-xs text-muted-foreground">{item.optionSummary}</p>
                )}
                <p className="mt-0.5 text-sm font-semibold">
                  {formatMoney(item.unitPrice, item.currency)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={() => onMove(key)}
                  aria-label={`Move ${label} back to your bag`}
                  className="text-sm font-semibold text-brand hover:underline"
                >
                  Move to bag
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(key)}
                  aria-label={`Remove ${label} from saved items`}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CartSkeleton() {
  return (
    <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-10">
      <div className="space-y-5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="h-28 w-24 rounded-xl" />
            <div className="flex-1 space-y-2 py-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-28 rounded-full" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}
