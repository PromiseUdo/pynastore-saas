/*
 * "Why shop with us" — the reassurance band.
 *
 * Sits low on the page on purpose: these promises answer objections a shopper
 * only forms once they're considering buying. Up at the top, under the hero,
 * they're wallpaper.
 *
 * Not shown on phones (ROADMAP 16.5).
 *
 * Server component — nothing here is interactive, so it costs no client JS.
 */
import { BadgeCheck, Headphones, RotateCcw, ShieldCheck, Truck } from 'lucide-react';
import { SectionHeader } from '@/components/storefront/common/section-header';

const ICONS: Record<string, typeof Truck> = {
  truck: Truck,
  'rotate-ccw': RotateCcw,
  'shield-check': ShieldCheck,
  'badge-check': BadgeCheck,
  headphones: Headphones,
};

export function ServiceFeatures({
  features,
}: {
  features: { icon: string; title: string; description: string }[];
}) {
  if (!features.length) return null;

  return (
    // Desktop only (ROADMAP 16.5): on a phone the shop is for shopping; the
    // product page and checkout state delivery and payment where they apply.
    <section className="sf-container sf-section max-lg:hidden">
      <SectionHeader
        /* The heading promises nothing of its own: each tile below restates
          * something this store's settings actually enforce, and a shop with
          * no returns window must not be framed as hassle-free returns. */
        title="Shopping here"
        align="center"
      />

      <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-5">
        {features.map((f) => {
          const Icon = ICONS[f.icon] ?? Truck;
          return (
            <li key={f.title} className="text-center">
              <span
                aria-hidden
                className="mx-auto flex size-16 items-center justify-center rounded-full bg-teal-soft text-teal"
              >
                <Icon className="size-7" strokeWidth={1.6} />
              </span>
              <h3 className="mt-5 text-base font-bold">{f.title}</h3>
              <p className="mx-auto mt-2 max-w-[22ch] text-sm leading-relaxed text-muted-foreground">
                {f.description}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
