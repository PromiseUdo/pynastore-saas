/*
 * "This app is no longer available" — what a store's own phone app shows
 * once its add-on has lapsed, or when the build was never registered
 * (ROADMAP 16.1). An app can't be removed from shoppers' phones, so it says
 * so plainly and points at the store's website instead of failing.
 *
 * proxy.ts rewrites every path of a closed app here, with `?store=` when it
 * knows whose app it was. The page reads nothing else from the request: at
 * worst a stranger who types the URL learns a store's public web address.
 */
import { prisma } from '@/lib/prisma';
import { getStorefrontUrl } from '@/lib/tenant/urls';

type Props = { searchParams: Promise<{ store?: string }> };

export const metadata = { title: 'App unavailable', robots: { index: false } };

export default async function AppUnavailablePage({ searchParams }: Props) {
  const { store: slug } = await searchParams;

  const store = slug
    ? await prisma.organization.findFirst({
        where: { slug, status: 'ACTIVE' },
        select: { name: true, slug: true, customStoreDomain: true },
      })
    : null;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="max-w-xs space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">This app is no longer available</h1>
        <p className="text-sm text-muted-foreground">
          {store
            ? `You can still shop with ${store.name} on their website.`
            : 'Please contact the store you got this app from.'}
        </p>
      </div>

      {store && (
        <a
          href={getStorefrontUrl(store.slug, '/', store.customStoreDomain)}
          className="inline-flex h-11 w-full max-w-xs items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Visit the website
        </a>
      )}
    </main>
  );
}
