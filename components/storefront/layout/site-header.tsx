'use client';

/*
 * Store header: wordmark left, search in the middle, wishlist/bag/account
 * right, with the category + primary nav on a second line below.
 *
 * The header itself is `sticky` — that also establishes the containing block
 * for the category dropdown's `absolute` panel in <CategoryNavBar>, so no
 * separate `relative` is needed (and stacking two position utilities is
 * undefined behaviour).
 */
import * as React from 'react';
import Link from 'next/link';
import { Heart, Menu, Search, ShoppingBag, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStorefront, useHydrated, useShopper } from '@/lib/storefront/context';
import { usePublicPathname } from '@/lib/storefront/use-public-pathname';
import { useUIStore } from '@/lib/storefront/stores/ui-store';
import { useCartCount } from '@/lib/storefront/stores/cart-store';
import { useWishlistStore } from '@/lib/storefront/stores/wishlist-store';
import type { NavItem } from '@/lib/storefront/nav-types';
import { CategoryNavBar } from './category-nav-bar';
import { HeaderSearch } from './header-search';
import { MobileMenu } from './mobile-menu';
import { SearchOverlay } from './search-overlay';
import { MiniCart } from './mini-cart';

function CountBadge({ count }: { count: number }) {
  return (
    <span
      className={cn(
        'absolute -right-0.5 -top-0.5 flex min-w-4.5 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-4.5',
        count > 0 ? 'bg-brand text-primary-foreground' : 'bg-secondary text-muted-foreground',
      )}
    >
      <span aria-hidden>{count > 99 ? '99+' : count}</span>
    </span>
  );
}

/** Circular icon button used for the three header actions. */
function IconAction({
  label,
  count,
  href,
  onClick,
  className: extra,
  children,
}: {
  label: string;
  count?: number;
  href?: string;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const className = cn(
    'relative flex size-11 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:border-brand hover:text-brand',
    extra,
  );
  /* The badge is decorative to a screen reader — the count belongs in the
   * control's own name ("Open bag, 3 items"), not as a stray number after it. */
  const accessibleName = count != null ? `${label}, ${count} item${count === 1 ? '' : 's'}` : label;
  const inner = (
    <>
      {children}
      {count != null && <CountBadge count={count} />}
    </>
  );
  return href ? (
    <Link href={href} aria-label={accessibleName} title={label} className={className}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} aria-label={accessibleName} title={label} className={className}>
      {inner}
    </button>
  );
}

export function SiteHeader({ navItems }: { navItems: NavItem[] }) {
  const { org } = useStorefront();
  const shopper = useShopper();
  const hydrated = useHydrated();
  const openMenu = useUIStore((s) => s.openMenu);
  const openSearch = useUIStore((s) => s.openSearch);
  const openCart = useUIStore((s) => s.openCart);

  // Units, not lines — `useCartCount` is hydration-safe, so the badge
  // renders 0 on the server and the real bag once mounted, without a flash.
  const cartCount = useCartCount();
  const wishCount = useWishlistStore((s) => s.items.length);

  const [scrolled, setScrolled] = React.useState(false);
  const [pastHero, setPastHero] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8);
      setPastHero(window.scrollY > 320);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /*
   * The homepage hero IS the search box, so showing a second one in the header
   * directly above it reads as a mistake. Hold it back until the hero has
   * scrolled away, then it becomes the persistent one. Every other route shows
   * it immediately.
   */
  const pathname = usePublicPathname();
  const showInlineSearch = pathname !== '/' || pastHero;

  return (
    <header
      data-sf-header
      className={cn(
        'sticky top-0 z-40 bg-background/95 backdrop-blur transition-shadow',
        scrolled && 'shadow-sm shadow-foreground/5',
      )}
    >
      <div className="sf-container flex h-18 items-center gap-3 lg:gap-8">
        <button
          onClick={openMenu}
          className="-ml-2 rounded-lg p-2 transition-colors hover:bg-accent lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="size-6" />
        </button>

        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          {org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logoUrl} alt={org.name} className="h-9 w-auto" />
          ) : (
            <>
              <span
                aria-hidden
                className="flex size-9 items-center justify-center rounded-lg bg-brand text-lg font-black text-primary-foreground"
              >
                {org.name.charAt(0).toUpperCase()}
              </span>
              {/* Capped on small screens so a long store name can't crowd out
                * the action buttons, but never hidden — the mark alone is one
                * letter and reads as no branding at all. */}
              <span className="max-w-24 truncate text-lg font-bold leading-tight tracking-tight sm:max-w-none">
                {org.name}
              </span>
            </>
          )}
        </Link>

        <HeaderSearch
          className={cn(
            'hidden flex-1 transition-opacity duration-200 lg:block',
            showInlineSearch ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        />

        <div className="ml-auto flex items-center gap-1.5 lg:ml-0 lg:gap-2">
          <button
            onClick={openSearch}
            aria-label="Search"
            className="flex size-11 items-center justify-center rounded-full border border-border bg-card transition-colors hover:border-brand hover:text-brand lg:hidden"
          >
            <Search className="size-5" />
          </button>
          <IconAction label="Wishlist" href="/wishlist" count={hydrated ? wishCount : 0}>
            <Heart className="size-5" />
          </IconAction>
          <IconAction label="Open bag" onClick={openCart} count={cartCount}>
            <ShoppingBag className="size-5" />
          </IconAction>
          {/* Hidden below sm: four 44px circles plus the wordmark overflow a
            * 390px viewport. Account is reachable from the hamburger menu. */}
          {/* Signed out, this goes to sign-in rather than to a page that
            * would only bounce there — and says so, so nobody taps it
            * expecting their orders. Resolved on the server (see
            * lib/storefront/context.tsx), so it is right on first paint. */}
          <IconAction
            label={shopper ? `Your account, ${shopper.firstName}` : 'Sign in'}
            href={shopper ? '/account' : '/account/sign-in'}
            className="hidden sm:flex"
          >
            <User className="size-5" />
          </IconAction>
        </div>
      </div>

      <CategoryNavBar navItems={navItems} />

      <MobileMenu items={navItems} />
      <SearchOverlay />
      <MiniCart />
    </header>
  );
}
