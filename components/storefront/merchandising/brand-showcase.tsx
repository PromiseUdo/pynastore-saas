/*
 * The shop's brands (ROADMAP 15.4) — only those with something on sale, in
 * alphabetical order (no ranking implied). A brand without a logo shows its
 * name instead of a placeholder picture. Each leads to the products filtered
 * to that brand.
 *
 * Server component.
 */
import Image from 'next/image';
import Link from 'next/link';
import type { Brand } from '@/lib/storefront/types';
import { SectionHeader } from '@/components/storefront/common/section-header';

export function BrandShowcase({ brands }: { brands: Brand[] }) {
  if (!brands.length) return null;
  return (
    <section className="sf-container sf-section">
      <SectionHeader title="Shop by brand" />
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {brands.map((brand) => (
          <li key={brand.id}>
            <Link
              href={`/products?brand=${encodeURIComponent(brand.slug)}`}
              className="flex h-24 items-center justify-center rounded-2xl border bg-card px-4 transition-colors hover:border-brand"
            >
              {brand.logoUrl ? (
                <span className="relative block h-12 w-full">
                  <Image src={brand.logoUrl} alt={brand.name} fill sizes="160px" className="object-contain" />
                </span>
              ) : (
                <span className="text-center text-sm font-semibold">{brand.name}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
