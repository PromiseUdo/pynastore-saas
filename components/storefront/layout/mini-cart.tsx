'use client';

/*
 * The mini-cart: the bag as a sheet, opened from the header, the mobile tab
 * bar, or the toast that follows an add.
 *
 * It is a VIEW. Every line it shows, every sum it prints and every button it
 * offers goes through the cart store (lib/storefront/stores/cart-store.ts),
 * which is also what the header badge and /cart read — there is one bag, and
 * three windows onto it.
 *
 * Adding does not navigate: the shopper sees the thing land, and can carry
 * on browsing or go to the bag. Being dragged to /cart on every add is the
 * behaviour this deliberately avoids.
 */
import Link from 'next/link';
import Image from 'next/image';
import { ProductImage } from '@/components/storefront/product/product-image';
import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import {
  SheetRoot,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/lib/storefront/stores/ui-store';
import { useCartStore } from '@/lib/storefront/stores/cart-store';
import { useHydrated } from '@/lib/storefront/context';
import { lineKey } from '@/lib/storefront/cart';
import { formatMoney } from '@/lib/storefront/format';

export function MiniCart() {
  const overlay = useUIStore((s) => s.overlay);
  const close = useUIStore((s) => s.close);
  const open = overlay === 'cart';
  const hydrated = useHydrated();

  const items = useCartStore((s) => s.items);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const subtotal = useCartStore((s) => s.subtotal());
  const count = useCartStore((s) => s.count());
  const currency = items[0]?.currency ?? 'NGN';

  return (
    <SheetRoot open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="w-full p-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            Your bag {hydrated && count > 0 && <span className="text-muted-foreground">({count})</span>}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Review the items in your bag, adjust quantities, and continue to checkout.
          </SheetDescription>
        </SheetHeader>

        {!hydrated || items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <ShoppingBag className="size-10 text-muted-foreground/50" strokeWidth={1.25} />
            <div>
              <p className="font-medium">Your bag is empty</p>
              <p className="mt-1 text-sm text-muted-foreground">Once you add something, it’ll show up here.</p>
            </div>
            <Button onClick={close} asChild>
              <Link href="/products">Start shopping</Link>
            </Button>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y overflow-y-auto px-6">
              {items.map((item) => {
                const key = lineKey(item);
                const label = item.optionSummary ? `${item.name} (${item.optionSummary})` : item.name;
                return (
                  <li key={key} className="flex gap-3 py-4">
                    <Link href={`/products/${item.productSlug}`} onClick={close} className="shrink-0">
                      <ProductImage
                        src={item.imageUrl}
                        name={item.name}
                        alt={item.name}
                        width={72}
                        height={88}
                        className="h-22 w-18 rounded-md object-cover"
                      />
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">{item.brandName}</p>
                          <Link
                            href={`/products/${item.productSlug}`}
                            onClick={close}
                            className="line-clamp-2 text-sm font-medium hover:text-brand"
                          >
                            {item.name}
                          </Link>
                          {item.optionSummary && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{item.optionSummary}</p>
                          )}
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatMoney(item.unitPrice, item.currency)} each
                          </p>
                        </div>
                        <button
                          onClick={() => removeItem(key)}
                          aria-label={`Remove ${label} from bag`}
                          className="h-fit rounded p-1 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>

                      <div className="mt-auto flex items-center justify-between pt-2">
                        <div className="flex items-center rounded-md border">
                          <button
                            onClick={() => updateQuantity(key, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                            title={item.quantity <= 1 ? 'Use remove to take this out of your bag' : undefined}
                            className="flex size-7 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                            aria-label={`Decrease quantity of ${label}`}
                          >
                            <Minus className="size-3.5" />
                          </button>
                          <span className="w-7 text-center text-sm tabular-nums" aria-live="polite">
                            <span className="sr-only">{label} quantity:</span>
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(key, item.quantity + 1)}
                            disabled={item.quantity >= item.maxQuantity}
                            className="flex size-7 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                            aria-label={`Increase quantity of ${label}`}
                          >
                            <Plus className="size-3.5" />
                          </button>
                        </div>
                        <span className="text-sm font-semibold">
                          {formatMoney(item.unitPrice * item.quantity, item.currency)}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            <SheetFooter className="flex-col items-stretch gap-3 bg-background">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="text-base font-semibold">{formatMoney(subtotal, currency)}</span>
              </div>
              <p className="text-xs text-muted-foreground">Shipping, taxes and discounts calculated at checkout.</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={close} asChild>
                  <Link href="/cart">View bag</Link>
                </Button>
                <Button onClick={close} asChild>
                  <Link href="/checkout">Checkout</Link>
                </Button>
              </div>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </SheetRoot>
  );
}
