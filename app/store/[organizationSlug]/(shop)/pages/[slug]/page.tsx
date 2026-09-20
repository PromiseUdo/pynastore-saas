/*
 * /pages/{slug} — one of the merchant's own pages: About, Delivery and
 * returns, FAQ, Size guide, Contact, Terms, Privacy, or one of theirs.
 *
 * Written in the admin (Settings → Store pages) and shown only once
 * published. There is no fallback text: an address with no published page
 * behind it is a 404, never a template.
 *
 * "Last updated" is shown because these are the store's terms — a shopper
 * relying on a returns policy should be able to see when it last changed.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/storefront/common/breadcrumbs';
import { PageBlocks } from '@/components/content/page-blocks';
import { getStorePage } from '@/lib/storefront/catalog';
import { pageExcerpt, pageOutline, parsePageBody } from '@/lib/storefront/pages/format';
import { formatDate } from '@/lib/storefront/format';
import { getStorefrontUrl } from '@/lib/tenant/urls';

type Props = { params: Promise<{ organizationSlug: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { organizationSlug, slug } = await params;
  const page = await getStorePage(slug, { organizationSlug });
  if (!page) return { title: 'Page not found' };
  return {
    title: page.title,
    description: pageExcerpt(page.body) || undefined,
    alternates: { canonical: getStorefrontUrl(organizationSlug, page.href) },
  };
}

export default async function StorePagePage({ params }: Props) {
  const { organizationSlug, slug } = await params;
  const page = await getStorePage(slug, { organizationSlug });
  if (!page) notFound();

  const blocks = parsePageBody(page.body);
  const outline = pageOutline(blocks);

  return (
    <div className="sf-container py-6 sm:py-10">
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: page.title }]} className="mb-5" />

      <div className="mx-auto w-full max-w-[46rem]">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{page.title}</h1>
        <p className="mt-2 text-xs text-muted-foreground">Last updated {formatDate(page.updatedAt)}</p>

        {/* A long policy or FAQ is easier to use with a way in to each part. */}
        {outline.length >= 4 && (
          <nav aria-label="On this page" className="mt-6 rounded-2xl border bg-card p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">On this page</p>
            <ul className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
              {outline.map((item) => (
                <li key={item.id}>
                  <Link href={`#${item.id}`} className="text-foreground underline-offset-2 hover:underline">
                    {item.text}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <PageBlocks blocks={blocks} className="mt-6" />
      </div>
    </div>
  );
}
