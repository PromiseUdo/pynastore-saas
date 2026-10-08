'use client';

import Link from 'next/link';
import { Home, LayoutGrid, Heart, ShoppingBag, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHydrated } from '@/lib/storefront/context';
import { usePublicPathname } from '@/lib/storefront/use-public-pathname';
import { useUIStore } from '@/lib/storefront/stores/ui-store';
import { useCartCount } from '@/lib/storefront/stores/cart-store';
import { useWishlistStore } from '@/lib/storefront/stores/wishlist-store';
import { useChatUnread } from '@/components/storefront/chat/chat-config';

/**
 * Bottom navigation on every phone-width screen — the app and phone
 * browsers alike (ROADMAP 16.5). It is the phone's whole navigation: the
 * header there is only a search box and there is no footer, so Account is a
 * tab, and leads to the account, the shop's own pages and the settings.
 */
export function MobileTabBar() {
  const pathname = usePublicPathname();
  const hydrated = useHydrated();
  const openMenu = useUIStore((s) => s.openMenu);
  const openCart = useUIStore((s) => s.openCart);
  const cartCount = useCartCount();
  const wishCount = useWishlistStore((s) => s.items.length);
  // The store replied: the way to it is the Account screen, one tap away.
  const chatUnread = useChatUnread();

  const isActive = (href: string) => pathname === href;

  const tab = 'relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium';

  return (
    // data-sf-tabbar: what floating buttons measure their height above (storefront.css, --sf-tabbar).
    <nav data-sf-tabbar className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex border-t bg-background/95 backdrop-blur lg:hidden">
      <Link href="/" className={cn(tab, isActive('/') ? 'text-brand' : 'text-muted-foreground')}>
        <Home className="size-5" /> Home
      </Link>
      <button onClick={openMenu} className={cn(tab, 'text-muted-foreground')}>
        <LayoutGrid className="size-5" /> Shop
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
      <Link
        href="/account/menu"
        className={cn(tab, pathname.startsWith('/account') ? 'text-brand' : 'text-muted-foreground')}
      >
        <span className="relative">
          <User className="size-5" />
          {hydrated && chatUnread > 0 && (
            <span aria-hidden className="absolute -right-1 -top-0.5 size-2 rounded-full bg-brand ring-2 ring-background" />
          )}
        </span>
        Account
        {hydrated && chatUnread > 0 && <span className="sr-only"> — the store has replied to your message</span>}
      </Link>
    </nav>
  );
}
