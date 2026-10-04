/*
 * Storefront homepage — the shop's own front page, built from its sections
 * (ROADMAP 15.2).
 *
 * Which sections, in what order, is the shop's design (published, or the
 * draft for a team member previewing it). A shop that hasn't arranged its
 * own gets the Classic front page — the one every shop had before:
 *
 *   hero → missions → recommended for you → continue exploring →
 *   popular right now → budget → deal of the day → new arrivals →
 *   shop by category → what this shop promises
 *
 * Each section type lives in components/storefront/home/homepage-sections.tsx
 * (load + render) and lib/storefront/sections/schema.ts (its shape). This
 * page doesn't know what any of them are.
 */
import { getRequestDesign } from '@/lib/storefront/catalog';
import { classicSections } from '@/lib/storefront/sections/schema';
import { HomepageSections } from '@/components/storefront/home/homepage-sections';

type Props = { params: Promise<{ organizationSlug: string }> };

export default async function StorefrontHomePage({ params }: Props) {
  const { organizationSlug } = await params;
  const store = { organizationSlug };
  const { design } = await getRequestDesign(store);

  return <HomepageSections store={store} sections={design.sections ?? classicSections()} />;
}
