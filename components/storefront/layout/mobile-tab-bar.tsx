'use client';

import Link from 'next/link';
import { Home, LayoutGrid, MessageCircle, ShoppingBag, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHydrated } from '@/lib/storefront/context';
import { usePublicPathname } from '@/lib/storefront/use-public-pathname';
import { useUIStore } from '@/lib/storefront/stores/ui-store';
import { useCartCount } from '@/lib/storefront/stores/cart-store';
import { useChatStore } from '@/lib/storefront/stores/chat-store';
import { useChatConfig, useChatUnread } from '@/components/storefront/chat/chat-config';

/**
 * Bottom navigation on every phone-width screen — the app and phone
 * browsers alike (ROADMAP 16.5). It is the phone's whole navigation: the
 * header there is only a search box and there is no footer, so Account is a
 * tab, and leads to the account, saved items, the shop's own pages and the
 * settings.
 *
 * Home · Shop · Bag · Messages · Account. Messages opens the chat with the
 * store, and is there only while the shop takes messages (ROADMAP 17) — a tab
 * that leads nowhere is worse than one fewer. Saved items live under Account.
 */
export function MobileTabBar() {
  const pathname = usePublicPathname();
  const hydrated = useHydrated();
  const openMenu = useUIStore((s) => s.openMenu);
  const openCart = useUIStore((s) => s.openCart);
  const cartCount = useCartCount();
  // Messages: only while the shop takes them; its badge is the store's unread replies.
  const chat = useChatConfig();
  const chatUnread = useChatUnread();
  const openChat = useChatStore((s) => s.openChat);

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
      {chat && (
        <button type="button" onClick={() => openChat(null)} className={cn(tab, 'text-muted-foreground')}>
          <span className="relative">
            <MessageCircle className="size-5" />
            {hydrated && chatUnread > 0 && (
              <span className="absolute -right-2 -top-1 rounded-full bg-brand px-1 text-[9px] leading-3 text-primary-foreground">
                {chatUnread > 99 ? '99+' : chatUnread}
              </span>
            )}
          </span>
          Messages
          {hydrated && chatUnread > 0 && <span className="sr-only"> — the store has replied to your message</span>}
        </button>
      )}
      <Link
        href="/account/menu"
        className={cn(tab, pathname.startsWith('/account') ? 'text-brand' : 'text-muted-foreground')}
      >
        <User className="size-5" />
        Account
      </Link>
    </nav>
  );
}
