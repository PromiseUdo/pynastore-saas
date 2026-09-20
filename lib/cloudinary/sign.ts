// lib/cloudinary/sign.ts
// Signed uploads: the browser uploads straight to Cloudinary (no file ever
// passes through our server), but only with parameters we signed — so it
// can't pick another org's folder or an arbitrary file type.
// Signature spec: sha1("k1=v1&k2=v2" sorted by key, excluding file/api_key/
// cloud_name/resource_type, + api_secret), hex.

import { createHash } from 'node:crypto';
import { getCloudinaryConfig, type CloudinaryConfig } from './config';

export const UPLOAD_PURPOSES = ['products', 'categories', 'brands'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const ALLOWED_IMAGE_FORMATS = 'jpg,jpeg,png,webp,avif,gif';

export function signParams(params: Record<string, string | number>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== '' && params[k] !== undefined)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1').update(toSign + apiSecret).digest('hex');
}

/** Folder every asset for one org + purpose lives in. */
export function assetFolder(organizationId: string, purpose: UploadPurpose): string {
  return `mansaas/${organizationId}/${purpose}`;
}

export type SignedUpload = {
  uploadUrl: string;
  fields: Record<string, string>;
};

export function signUpload(
  organizationId: string,
  purpose: UploadPurpose,
  config: CloudinaryConfig = getCloudinaryConfig(),
  now = Date.now(),
): SignedUpload {
  const params = {
    allowed_formats: ALLOWED_IMAGE_FORMATS,
    folder: assetFolder(organizationId, purpose),
    timestamp: Math.floor(now / 1000),
  };
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    fields: {
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      api_key: config.apiKey,
      signature: signParams(params, config.apiSecret),
    },
  };
}

/**
 * True when `url`/`publicId` is an image this org uploaded through us — the
 * server's check before saving an image reference, so a crafted request
 * can't attach another tenant's (or an arbitrary) asset.
 */
export function isOrgAsset(
  image: { url: string; publicId: string | null | undefined },
  organizationId: string,
  cloudName: string = getCloudinaryConfig().cloudName,
): boolean {
  const prefix = `mansaas/${organizationId}/`;
  if (!image.publicId || !image.publicId.startsWith(prefix)) return false;
  let parsed: URL;
  try {
    parsed = new URL(image.url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname === 'res.cloudinary.com' &&
    parsed.pathname.startsWith(`/${cloudName}/image/upload/`) &&
    parsed.pathname.includes(`/${image.publicId}`)
  );
}

/** Best-effort delete; a leftover asset is cheaper than a failed save. */
export async function destroyAsset(publicId: string): Promise<void> {
  try {
    const config = getCloudinaryConfig();
    const params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };
    const body = new URLSearchParams({
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      api_key: config.apiKey,
      signature: signParams(params, config.apiSecret),
    });
    const res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/destroy`, { method: 'POST', body });
    if (!res.ok) console.error('[cloudinary] destroy failed', publicId, res.status);
  } catch (err) {
    console.error('[cloudinary] destroy failed', publicId, err);
  }
}
