/*
 * /app — "Get the {store} app" (ROADMAP 16.4).
 *
 * Where the website's banner and footer link lead, for a store that has its
 * own app listed in the App Store or on Google Play. On a phone it's one tap
 * to the right store; on a computer the QR code carries this same page to the
 * shopper's phone, where it is one tap again.
 *
 * Only for an app that is really listed (lib/mobile/listing.ts); anything
 * else is a 404, never a page promising an app nobody can download. Inside
 * the app itself the page has no purpose, so it goes home.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { getStoreAppListing } from '@/lib/mobile/listing';
import { storefrontUrlFor } from '@/lib/domains/storefront-url';
import { storePathPrefix } from '@/lib/storefront/store-path';

type Props = { params: Promise<{ organizationSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { organizationSlug } = await params;
  const listing = await getStoreAppListing({ organizationSlug });
  return listing ? { title: `Get the ${listing.name} app` } : {};
}

export default async function GetTheAppPage({ params }: Props) {
  const { organizationSlug } = await params;
  if ((await headers()).get('x-runtime') === 'mobile') redirect(`${await storePathPrefix(organizationSlug)}/`);

  const listing = await getStoreAppListing({ organizationSlug });
  if (!listing) notFound();

  const pageUrl = await storefrontUrlFor(organizationSlug, '/app');
  // Black on white whatever the theme: that is what a phone camera reads best.
  const qr = await QRCode.toString(pageUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });

  return (
    <div className="sf-container py-10 sm:py-14">
      <div className="mx-auto w-full max-w-[42rem] text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Get the {listing.name} app</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {`Shop ${listing.name} straight from your phone’s home screen.`}
        </p>

        <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
          {listing.appStoreUrl && (
            <a
              href={listing.appStoreUrl}
              className="inline-flex h-12 items-center justify-center rounded-[var(--sf-radius-button,999px)] bg-brand px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
            >
              Download on the App Store
            </a>
          )}
          {listing.googlePlayUrl && (
            <a
              href={listing.googlePlayUrl}
              className="inline-flex h-12 items-center justify-center rounded-[var(--sf-radius-button,999px)] bg-brand px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
            >
              Get it on Google Play
            </a>
          )}
        </div>

        <div className="mx-auto mt-10 hidden w-fit rounded-3xl border border-border bg-card p-6 sm:block">
          <div
            role="img"
            aria-label={`QR code for ${pageUrl}`}
            className="mx-auto size-44 rounded-lg bg-white p-1 [&_svg]:size-full"
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          <p className="mt-3 text-sm text-muted-foreground">On a computer? Scan this with your phone&apos;s camera.</p>
        </div>
      </div>
    </div>
  );
}
