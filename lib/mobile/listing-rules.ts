/*
 * lib/mobile/listing-rules.ts
 *
 * The pure half of ./listing.ts: store links, and when a store's app may be
 * offered on its website at all (ROADMAP 16.4). Safe anywhere, including the
 * record-keeping script.
 */

export interface StoreAppListing {
  /** the name under the icon */
  name: string;
  appStoreUrl: string | null;
  /** the number Apple's own Smart App Banner needs */
  appStoreId: string | null;
  googlePlayUrl: string | null;
}

export const appStoreUrl = (appStoreId: string) => `https://apps.apple.com/app/id${appStoreId}`;
export const googlePlayUrl = (appId: string) =>
  `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`;

/** App Store ids are the digits in apps.apple.com/app/id123456789. */
export function isAppStoreId(value: string): boolean {
  return /^\d{6,12}$/.test(value);
}

export function listingFor(app: {
  name: string;
  appId: string;
  status: string;
  appStoreId: string | null;
  onGooglePlay: boolean;
  promoteOnWebsite: boolean;
}): StoreAppListing | null {
  if (app.status !== 'ACTIVE' || !app.promoteOnWebsite) return null;
  const appStoreId = app.appStoreId && isAppStoreId(app.appStoreId) ? app.appStoreId : null;
  if (!appStoreId && !app.onGooglePlay) return null;
  return {
    name: app.name,
    appStoreId,
    appStoreUrl: appStoreId ? appStoreUrl(appStoreId) : null,
    googlePlayUrl: app.onGooglePlay ? googlePlayUrl(app.appId) : null,
  };
}
