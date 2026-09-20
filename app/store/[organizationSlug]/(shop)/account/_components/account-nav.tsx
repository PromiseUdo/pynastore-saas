'use client';

/*
 * The account's own navigation: a column beside the content on a laptop, a
 * scrollable row of pills above it on a phone.
 *
 * MIN-WIDTH IS LOAD-BEARING. A grid item defaults to `min-width: auto`, so
 * without `min-w-0` this strip refuses to shrink below its own content and
 * stretches the whole page instead — every account page scrolled sideways by
 * 225px on a phone, with the cards cut off at the right edge, until this was
 * fixed. `overflow-x-auto` cannot save a box that is never asked to shrink.
 *
 * The bleed is -mx-5 because `.sf-container` pads 1.25rem on a phone: the
 * strip has to reach the screen edge so a half-visible pill shows there is
 * more to scroll, and the first pill still has to line up with the cards.
 *
 * Sign out is NOT in the scroll strip. It would sit off-screen past four
 * pills, which is a poor place for the one control people go looking for; on
 * a phone it renders under the content instead (see <SignOutButton />).
 */
import Link from 'next/link';
import { LayoutGrid, LogOut, MapPin, Package, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePublicPathname } from '@/lib/storefront/use-public-pathname';
import { signOutAction } from '@/features/shop-account/actions';

const ITEMS = [
  { href: '/account', label: 'Overview', icon: LayoutGrid },
  { href: '/account/orders', label: 'Orders', icon: Package },
  { href: '/account/addresses', label: 'Addresses', icon: MapPin },
  { href: '/account/profile', label: 'Profile', icon: UserRound },
];

export function AccountNav() {
  const pathname = usePublicPathname();

  return (
    <nav aria-label="Account" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
      <ul className="sf-no-scrollbar -mx-5 flex min-w-0 gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          // /account/addresses/new is still "Addresses"; /account is only
          // itself, or every tab would light up at once.
          const active = href === '/account' ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-11 items-center gap-2.5 rounded-full border px-4 text-sm font-medium transition-colors lg:w-full lg:rounded-xl',
                  active
                    ? 'border-brand bg-brand text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:border-brand hover:text-brand',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Desktop only: on a phone this lives under the content. */}
      <div className="mt-2 hidden lg:block">
        <SignOutButton />
      </div>
    </nav>
  );
}

/**
 * Sign out. A form rather than a link because it changes something — a
 * <Link> that signs you out is a link a browser may prefetch.
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="flex h-11 w-full items-center justify-center gap-2.5 rounded-full border border-border bg-card px-4 text-sm font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive lg:justify-start lg:rounded-xl"
      >
        <LogOut className="size-4" aria-hidden />
        Sign out
      </button>
    </form>
  );
}
