/*
 * lib/storefront/nav-types.ts
 *
 * The header navigation's shape and its two pure helpers. Split out of
 * ./navigation.ts because the header, flyout and search field are client
 * components, while the builder next door reads the catalogue (and so,
 * Prisma) — which must never reach the browser bundle.
 */

export interface NavLink {
  id: string;
  name: string;
  href: string;
  /** category thumbnail — rendered as the icon on flyout/sidebar cards */
  imageUrl?: string;
  /** number of products in this node and all descendants */
  productCount?: number;
}

export interface NavColumn extends NavLink {
  links: NavLink[];
}

export interface NavPromo {
  eyebrow: string;
  title: string;
  ctaLabel: string;
  href: string;
  imageUrl: string;
}

export interface NavItem {
  id: string;
  name: string;
  href: string;
  /** short blurb shown at the top of the category flyout */
  description?: string;
  imageUrl?: string;
  productCount?: number;
  /** mega-menu columns (level-1 categories with their level-2 children) */
  columns: NavColumn[];
  /** quick links shown above the columns (e.g. New in, Sale, Best sellers) */
  quickLinks: NavLink[];
  promo?: NavPromo;
  highlight?: 'sale';
}

/** Every leaf category under a nav item, flattened — the flyout renders these
 *  as a single dense grid rather than nesting two more levels of menu. */
export function leafLinks(item: NavItem): NavLink[] {
  return item.columns.flatMap((c) => (c.links.length ? c.links : [c]));
}

export function categoryHref(path: string[]): string {
  return `/c/${path.join('/')}`;
}
