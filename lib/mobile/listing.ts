/*
 * lib/mobile/listing.ts
 *
 * Where shoppers can get a store's own app (ROADMAP 16.4), for the "Get our
 * app" banner, page and footer link on the store's WEBSITE. Server only.
 *
 * Only what is real: an app that is ACTIVE, that the merchant hasn't asked
 * us to stop promoting, and that has at least one approved listing. Before
 * a listing is recorded there is nothing to download, so nothing is shown.
 */
import { prisma } from '@/lib/prisma';

export { appStoreUrl, googlePlayUrl, isAppStoreId, listingFor, type StoreAppListing } from './listing-rules';
import { listingFor, type StoreAppListing } from './listing-rules';

export async function getStoreAppListing(store: { organizationSlug: string }): Promise<StoreAppListing | null> {
  const app = await prisma.mobileApp.findFirst({
    where: { organization: { slug: store.organizationSlug, status: 'ACTIVE' } },
    select: { name: true, appId: true, status: true, appStoreId: true, onGooglePlay: true, promoteOnWebsite: true },
  });
  return app ? listingFor(app) : null;
}
