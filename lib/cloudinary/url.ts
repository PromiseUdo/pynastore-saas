// lib/cloudinary/url.ts
// Client-safe delivery helpers. Cloudinary resizes/re-encodes on the fly
// when a transformation is inserted after `/upload/`, so admin thumbnails
// don't download full-size originals.

type Transform = { width?: number; height?: number; crop?: 'fill' | 'fit' | 'limit' };

export function cloudinaryImage(url: string, { width, height, crop = 'fill' }: Transform = {}): string {
  if (!url.includes('res.cloudinary.com') || !url.includes('/image/upload/')) return url;
  const parts = [`c_${crop}`, width && `w_${width}`, height && `h_${height}`, 'f_auto', 'q_auto'].filter(Boolean);
  return url.replace('/image/upload/', `/image/upload/${parts.join(',')}/`);
}
