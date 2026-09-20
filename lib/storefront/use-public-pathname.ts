'use client';

/*
 * The storefront's slug-free pathname.
 *
 * proxy.ts rewrites the public URL to an internal, slug-prefixed route:
 *   shop.{slug}.{ROOT_DOMAIN}/cart  ->  /store/{slug}/cart
 *   {mobile origin}/s/{slug}/cart   ->  /store/{slug}/cart
 *
 * `usePathname()` reports whichever path actually matched for the current
 * render pass — the rewritten internal one during SSR, the real (public,
 * slug-free) browser URL after hydration. Comparing that raw value against
 * slug-free hrefs makes the two passes disagree, which shows up as a
 * hydration mismatch on every active nav state.
 *
 * `stripStorefrontPrefix` normalises both passes to the same public path.
 * (components/layout/sidebar.tsx does the equivalent for the admin app, whose
 * internal prefix is a bare `/{slug}`.)
 */
import { usePathname } from 'next/navigation';
import { useStorefront } from './context';

export function stripStorefrontPrefix(pathname: string, orgSlug: string): string {
  for (const prefix of [`/store/${orgSlug}`, `/s/${orgSlug}`]) {
    if (pathname === prefix) return '/';
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }
  return pathname;
}

export function usePublicPathname(): string {
  const raw = usePathname() ?? '/';
  const { org } = useStorefront();
  return stripStorefrontPrefix(raw, org.slug);
}
