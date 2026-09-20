'use client';

import Link from 'next/link';
import { Home, LayoutGrid, Search, Heart, ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStorefront, useHydrated } from '@/lib/storefront/context';
import { usePublicPathname } from '@/lib/storefront/use-public-pathname';
import { useUIStore } from '@/lib/storefront/stores/ui-store';
import { useCartCount } from '@/lib/storefront/stores/cart-store';
import { useWishlistStore } from '@/lib/storefront/stores/wishlist-store';

/**
 * Bottom navigation — only rendered on the dedicated mobile origin / inside
 * the Capacitor shell (see StorefrontProvider `isMobileRuntime`).
 */
export function MobileTabBar() {
  const { isMobileRuntime } = useStorefront();
  const pathname = usePublicPathname();
  const hydrated = useHydrated();
  const openSearch = useUIStore((s) => s.openSearch);
  const openMenu = useUIStore((s) => s.openMenu);
  const openCart = useUIStore((s) => s.openCart);
  const cartCount = useCartCount();
  const wishCount = useWishlistStore((s) => s.items.length);

  if (!isMobileRuntime) return null;

  const isActive = (href: string) => pathname === href;

  const tab = 'relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium';

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex border-t bg-background/95 backdrop-blur lg:hidden">
      <Link href="/" className={cn(tab, isActive('/') ? 'text-brand' : 'text-muted-foreground')}>
        <Home className="size-5" /> Home
      </Link>
      <button onClick={openMenu} className={cn(tab, 'text-muted-foreground')}>
        <LayoutGrid className="size-5" /> Shop
      </button>
      <button onClick={openSearch} className={cn(tab, 'text-muted-foreground')}>
        <Search className="size-5" /> Search
      </button>
      <Link href="/wishlist" className={cn(tab, isActive('/wishlist') ? 'text-brand' : 'text-muted-foreground')}>
        <span className="relative">
          <Heart className="size-5" />
          {hydrated && wishCount > 0 && (
            <span className="absolute -right-2 -top-1 rounded-full bg-brand px-1 text-[9px] leading-3 text-primary-foreground">
              {wishCount}
            </span>
          )}
        </span>
        Saved
      </Link>
      <button onClick={openCart} className={cn(tab, 'text-muted-foreground')}>
        <span className="relative">
          <ShoppingBag className="size-5" />
          {cartCount > 0 && (
            <span className="absolute -right-2 -top-1 rounded-full bg-brand px-1 text-[9px] leading-3 text-primary-foreground">
              {cartCount}
            </span>
          )}
        </span>
        Bag
      </button>
    </nav>
  );
}
