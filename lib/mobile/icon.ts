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
