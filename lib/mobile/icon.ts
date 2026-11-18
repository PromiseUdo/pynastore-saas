/*
 * lib/mobile/icon.ts
 *
 * The merchant's app icon as the build kit needs it (ROADMAP 16.2): a
 * 1024 px PNG, made by Cloudinary from whatever they uploaded. Pure — the
 * kit (scripts/mobile/store-app.ts) imports it too.
 */
export function appIconPngUrl(iconUrl: string): string {
  if (!iconUrl.includes('res.cloudinary.com') || !iconUrl.includes('/image/upload/')) return iconUrl;
  return iconUrl.replace('/image/upload/', '/image/upload/c_pad,w_1024,h_1024,b_transparent,f_png/');
}

/**
 * The shop's favicon as a home-screen icon (decided 2026-11-18: the app's
 * icon in the phone's app drawer is the favicon; the logo only when there is
 * none). A 1024 px square PNG with the mark at about two-thirds size on its
 * own background colour (`b_auto` takes it from the favicon's edges), so
 * Android's round and rounded-square masks never clip it.
 */
export function faviconAppIconPngUrl(faviconUrl: string): string {
  if (!faviconUrl.includes('res.cloudinary.com') || !faviconUrl.includes('/image/upload/')) return faviconUrl;
  return faviconUrl.replace('/image/upload/', '/image/upload/c_pad,w_700,h_700,b_auto/c_mpad,w_1024,h_1024,b_auto/f_png/');
}
