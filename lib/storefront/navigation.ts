/*
 * Header navigation, derived from the store's own category tree. Server-only
 * (called from the storefront layout); the resulting plain object is handed
 * to the client header.
 *
 * Shape: 3 levels — top bar item (L0 root) → mega-menu columns (L1) → links
 * within a column (L2), e.g. Fashion › Women's › Skirts.
 *
 * Everything here comes from the merchant's own categories and the queries
 * this storefront really supports. There is no per-store copywriting to
 * invent: a quick link is a sort or a tag the catalogue understands.
 */
import { getCategoryTree } from './catalog';
import type { StoreScope } from './types';
import type { CategoryNode } from './types';
import { categoryHref, type NavItem } from './nav-types';

export * from './nav-types';

/** Shown under a department, and only when it would find something. */
const QUICK_LINKS: { name: string; suffix: string }[] = [
  { name: 'New in', suffix: '?sort=newest' },
  { name: 'Best sellers', suffix: '?sort=bestselling' },
  { name: 'On sale', suffix: '?tag=sale' },
];

export async function getNavItems(scope?: StoreScope): Promise<NavItem[]> {
  const tree = await getCategoryTree(scope);

  const items: NavItem[] = tree
    .filter((root) => root.featured || root.productCount > 0)
    .map((root: CategoryNode) => {
      const base = categoryHref(root.path);
      return {
        id: root.id,
        name: root.name,
        href: base,
        description: root.description,
        imageUrl: root.imageUrl,
        productCount: root.productCount,
        columns: root.children.map((child) => ({
          id: child.id,
          name: child.name,
          href: categoryHref(child.path),
          imageUrl: child.imageUrl,
          productCount: child.productCount,
          links: child.children.map((leaf) => ({
            id: leaf.id,
            name: leaf.name,
            href: categoryHref(leaf.path),
            imageUrl: leaf.imageUrl,
            productCount: leaf.productCount,
          })),
        })),
        // A department with nothing in it gets no quick links to nowhere.
        quickLinks: root.productCount
          ? QUICK_LINKS.map((q) => ({ id: `${root.id}-${q.name}`, name: q.name, href: `${base}${q.suffix}` }))
          : [],
      };
    });

  const hasProducts = tree.some((root) => root.productCount > 0);
  return [
    ...(hasProducts ? [{ id: 'new', name: 'New in', href: '/products?sort=newest', columns: [], quickLinks: [] }] : []),
    ...items,
    ...(hasProducts ? [{ id: 'sale', name: 'Sale', href: '/sale', columns: [], quickLinks: [], highlight: 'sale' as const }] : []),
  ];
}
