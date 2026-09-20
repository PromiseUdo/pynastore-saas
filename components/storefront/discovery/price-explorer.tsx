/*
 * "What fits your budget?" — many shoppers think in money before category.
 *
 * Server component. Bands are computed from the catalogue's real price
 * distribution (see getPriceBands) rather than fixed tiers, and each carries
 * the true number of products inside it, so the band labels stay honest for a
 * store selling snacks and one selling laptops alike. Currency comes from the
 * catalogue too — no symbol is hardcoded anywhere in this path.
 */
import { ArrowUpRight } from 'lucide-react';
import { DiscoveryTrigger } from './discovery-trigger';
import type { PriceBand } from '@/lib/storefront/discovery';
import { SectionHeader } from '@/components/storefront/common/section-header';

export function PriceExplorer({ bands }: { bands: PriceBand[] }) {
  if (bands.length < 2) return null;

  return (
    <section className="sf-container sf-section">
      <SectionHeader
        eyebrow="By budget"
        title="What fits your budget?"
        subtitle="Start from what you want to spend."
      />

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {bands.map((band) => (
          <li key={band.id}>
            <DiscoveryTrigger
              // The href is what the listing page will read once it exists;
              // today the click resolves in the hero's results surface.
              href={`/products?${new URLSearchParams({
                ...(band.minPrice != null ? { min: String(band.minPrice) } : {}),
                ...(band.maxPrice != null ? { max: String(band.maxPrice) } : {}),
              })}`}
              request={{
                minPrice: band.minPrice,
                maxPrice: band.maxPrice,
                label: band.label,
              }}
              className="group flex h-full items-start justify-between gap-3 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-brand"
            >
              <span>
                <span className="block text-[0.9375rem] font-bold leading-snug">{band.label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {band.productCount} {band.productCount === 1 ? 'product' : 'products'}
                </span>
              </span>
              <ArrowUpRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand"
              />
            </DiscoveryTrigger>
          </li>
        ))}
      </ul>
    </section>
  );
}
