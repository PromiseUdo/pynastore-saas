// lib/cloudinary/config.ts
// Server-only: reads the API secret. Never import from a client component.

export type CloudinaryConfig = { cloudName: string; apiKey: string; apiSecret: string };

export function getCloudinaryConfig(): CloudinaryConfig {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary is not configured (NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, NEXT_PUBLIC_CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)');
  }
  return { cloudName, apiKey, apiSecret };
}
