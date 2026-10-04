/*
 * Online store → Customize (ROADMAP 15.1, 15.3).
 *
 * Three tabs: the shop's LOOK (look, colour, light/dark, Fine-tune) and its
 * FRONT PAGE (which sections, in what order) — both saved as one draft,
 * previewed, then published together — and its SLIDES (content, which saves
 * live). All need `storefront.design`.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { AccessDenied } from '@/components/layout/access-denied';
import { storefrontUrlFor } from '@/lib/domains/storefront-url';
import { getDesignEditor } from '@/features/storefront/design';
import { listHeroSlides } from '@/features/storefront/slides';
import { CustomizeClient, type CustomizeView } from './_components/CustomizeClient';

export const metadata: Metadata = { title: 'Customize your store' };

export default async function CustomizePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await getOrganizationContext();
  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.STOREFRONT_DESIGN)) {
    return <AccessDenied what="your online store’s look" />;
  }
  const requested = (await searchParams).view;
  const view: CustomizeView =
    requested === 'slides' || requested === 'homepage' || requested === 'chrome' ? requested : 'look';

  const [editor, slides] = await Promise.all([getDesignEditor(), listHeroSlides()]);
  if (!editor.success) throw new Error(editor.error);
  if (!slides.success) throw new Error(slides.error);

  /* Real places a slide's button can point at — the same reasoning as a
   * campaign announcement: a typed path is a 404 waiting for a customer. */
  const [collections, categories, pages, brands] = await Promise.all([
    prisma.collection.findMany({
      where: { organizationId: ctx.organization.id, isVisible: true },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    }),
    prisma.category.findMany({
      where: { organizationId: ctx.organization.id, isVisible: true },
      select: { id: true, name: true, slug: true, parentId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.storePage.findMany({
      where: { organizationId: ctx.organization.id, isPublished: true },
      select: { title: true, slug: true },
      orderBy: { title: 'asc' },
    }),
    prisma.brand.findMany({
      where: { organizationId: ctx.organization.id },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const pathFor = (id: string): string[] => {
    const path: string[] = [];
    let current = categories.find((c) => c.id === id);
    while (current) {
      path.unshift(current.slug);
      current = current.parentId ? categories.find((c) => c.id === current!.parentId) : undefined;
    }
    return path;
  };

  const destinations = [
    { label: 'All products', href: '/products' },
    ...collections.map((c) => ({ label: `Collection · ${c.name}`, href: `/collections/${c.slug}` })),
    ...categories.map((c) => ({ label: `Category · ${c.name}`, href: `/c/${pathFor(c.id).join('/')}` })),
    ...pages.map((p) => ({ label: `Page · ${p.title}`, href: `/pages/${p.slug}` })),
  ];

  return (
    <CustomizeClient
      view={view}
      editor={editor.data}
      slides={slides.data}
      destinations={destinations}
      sourceOptions={{
        collections: collections.map((c) => ({ id: c.id, name: c.name })),
        categories: categories
          .map((c) => ({
            id: c.id,
            label: pathFor(c.id)
              .map((slug) => categories.find((x) => x.slug === slug)?.name ?? slug)
              .join(' › '),
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
        brands,
      }}
      storeUrl={await storefrontUrlFor(ctx.organization.slug)}
    />
  );
}
