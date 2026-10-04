/*
 * lib/storefront/design/footer.ts
 *
 * The storefront footer's columns, arranged the way the shop chose
 * (ROADMAP 15.5). Pure.
 *
 * The four standard columns are still WORKED OUT from the shop's own data —
 * its departments, the account pages, its published store pages — and are
 * never retyped by the merchant; the design only says which show and in
 * what order. Help and About only exist when the shop has published a page
 * for them, whatever the design says. The merchant's own column is the one
 * thing typed: a heading and up to six links to pages on the shop.
 *
 * No footer setting (null) is the Classic footer: Shop, Your account, Help,
 * About — exactly as before.
 */
import { classicFooter, type DerivedFooterColumn, type FooterConfig } from './schema';

export interface BuiltFooterColumn {
  title: string;
  links: { label: string; href: string }[];
}

export function arrangeFooter(
  config: FooterConfig | null,
  derived: Record<DerivedFooterColumn, BuiltFooterColumn | null>,
): BuiltFooterColumn[] {
  const columns: BuiltFooterColumn[] = [];
  for (const column of (config ?? classicFooter()).columns) {
    if (!column.enabled) continue;
    if (column.key === 'links') {
      if (column.title && column.links.length) columns.push({ title: column.title, links: column.links });
      continue;
    }
    const built = derived[column.key];
    if (built && built.links.length) columns.push(built);
  }
  return columns;
}
