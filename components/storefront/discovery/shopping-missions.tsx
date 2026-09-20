/*
 * "Shop by what you're doing" — an axis that cuts across departments.
 *
 * Server component. The missions are resolved in lib/storefront/discovery.ts
 * against the real catalogue and any with no stock behind them are dropped
 * before this renders, so nothing here can advertise a mission the store
 * can't fill. Counts and preview imagery come from the products themselves.
 *
 * Each tile carries the real category href — traditional browsing, preserved —
 * but resolves in place against the discovery results surface, because the
 * listing routes don't exist yet. See <DiscoveryTrigger>.
 */
import Image from 'next/image';
import type { Mission } from '@/lib/storefront/discovery';
import { DiscoveryTrigger } from './discovery-trigger';
import { categoryHref } from '@/lib/storefront/navigation';
import { SectionHeader } from '@/components/storefront/common/section-header';

export function ShoppingMissions({ missions }: { missions: Mission[] }) {
  if (!missions.length) return null;

  return (
    <section className="sf-container sf-section">
      <SectionHeader
        eyebrow="Start here"
        title="Shop by what you’re doing"
        subtitle="Pick the occasion rather than the department — we’ll show what fits."
      />

      {/* Horizontal scroll on phones so the tiles stay big enough to tap,
        * rather than shrinking six of them onto one screen. */}
      <ul className="sf-no-scrollbar -mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-6">
        {missions.map((m) => (
          <li key={m.id} className="w-[9.5rem] shrink-0 snap-start sm:w-auto">
            <DiscoveryTrigger
              href={categoryHref(m.match.categoryPath ?? [])}
              request={{ mission: m.id, label: m.label }}
              className="group flex h-full flex-col rounded-2xl border border-border bg-card p-4 transition-colors hover:border-brand"
            >
              <span aria-hidden className="text-2xl leading-none">
                {m.icon}
              </span>
              <span className="mt-3 text-[0.9375rem] font-bold leading-snug">{m.label}</span>
              <span className="mt-1 text-xs leading-relaxed text-muted-foreground">{m.blurb}</span>

              {/* Real products from inside the mission, as a visual hint. */}
              {m.previewImages.length > 0 && (
                <span className="mt-auto flex items-center gap-2 pt-4">
                  <span className="flex -space-x-2">
                    {m.previewImages.slice(0, 3).map((src) => (
                      <Image
                        key={src}
                        src={src}
                        alt=""
                        width={26}
                        height={26}
                        className="size-6.5 rounded-full border-2 border-card bg-tile object-cover"
                      />
                    ))}
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {m.productCount}
                  </span>
                </span>
              )}
            </DiscoveryTrigger>
          </li>
        ))}
      </ul>
    </section>
  );
}
