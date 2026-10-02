// lib/cloudinary/sign.ts
// Signed uploads: the browser uploads straight to Cloudinary (no file ever
// passes through our server), but only with parameters we signed — so it
// can't pick another org's folder or an arbitrary file type.
// Signature spec: sha1("k1=v1&k2=v2" sorted by key, excluding file/api_key/
// cloud_name/resource_type, + api_secret), hex.

import { createHash } from 'node:crypto';
import { getCloudinaryConfig, type CloudinaryConfig } from './config';

export const UPLOAD_PURPOSES = ['products', 'categories', 'brands', 'organization', 'campaigns', 'storefront'] as const;
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

/* ---------------- private documents ---------------- */

/*
 * Verification documents (ROADMAP 10.2/10.8) are not images for a page: they
 * are a business's CAC certificate, an ID and a utility bill. They are
 * uploaded as `type: private`, so Cloudinary serves no public URL for them at
 * all, and they are opened only through privateDownloadUrl — a link signed on
 * the server that stops working after a few minutes.
 */

export const ALLOWED_DOCUMENT_FORMATS = 'pdf,jpg,jpeg,png,webp';

export function documentFolder(organizationId: string): string {
  return `mansaas/${organizationId}/verification`;
}

export function signDocumentUpload(
  organizationId: string,
  config: CloudinaryConfig = getCloudinaryConfig(),
  now = Date.now(),
): SignedUpload {
  const params = {
    allowed_formats: ALLOWED_DOCUMENT_FORMATS,
    folder: documentFolder(organizationId),
    timestamp: Math.floor(now / 1000),
    type: 'private',
  };
  return {
    // PDFs are handled by Cloudinary's image pipeline, so one endpoint takes both.
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    fields: {
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      api_key: config.apiKey,
      signature: signParams(params, config.apiSecret),
    },
  };
}

/**
 * True when `publicId` is a document this org uploaded through us. The server
 * checks this before saving a document reference, so a crafted request can't
 * attach another tenant's file.
 */
export function isOrgDocument(publicId: string, organizationId: string): boolean {
  const prefix = `${documentFolder(organizationId)}/`;
  return publicId.startsWith(prefix) && /^[A-Za-z0-9_\-/.]+$/.test(publicId) && !publicId.includes('..');
}

/**
 * A link that downloads one private document and expires after
 * `expiresInSeconds`. Cloudinary's "private download URL": the parameters are
 * signed exactly like an upload, so nobody can change the file it points at.
 */
export function privateDownloadUrl(
  publicId: string,
  format: string,
  { expiresInSeconds = 300 }: { expiresInSeconds?: number } = {},
  config: CloudinaryConfig = getCloudinaryConfig(),
  now = Date.now(),
): string {
  const timestamp = Math.floor(now / 1000);
  const params = {
    expires_at: timestamp + expiresInSeconds,
    format,
    public_id: publicId,
    timestamp,
    type: 'private',
  };
  const query = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    api_key: config.apiKey,
    signature: signParams(params, config.apiSecret),
  });
  return `https://api.cloudinary.com/v1_1/${config.cloudName}/image/download?${query}`;
}

/** Best-effort delete; a leftover asset is cheaper than a failed save. */
export async function destroyAsset(publicId: string, { type }: { type?: 'private' } = {}): Promise<void> {
  try {
    const config = getCloudinaryConfig();
    const params: Record<string, string | number> = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };
    if (type) params.type = type;
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

/**
 * Delete every file a workspace ever uploaded — its whole `mansaas/{orgId}/`
 * folder, public images and private verification documents alike (ROADMAP
 * 13.8, when a closed workspace is purged). Uses Cloudinary's Admin API,
 * which deletes by prefix up to 1,000 at a time. Returns how many were
 * deleted; throws if Cloudinary refuses, so the purge can try again later.
 */
export async function destroyOrganizationAssets(organizationId: string): Promise<number> {
  const config = getCloudinaryConfig();
  const prefix = `mansaas/${organizationId}/`;
  const auth = `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64')}`;
  let deleted = 0;
  for (const resourceType of ['image', 'raw', 'video'] as const) {
    for (const type of ['upload', 'private', 'authenticated'] as const) {
      let cursor: string | undefined;
      do {
        const params = new URLSearchParams({ prefix, ...(cursor ? { next_cursor: cursor } : {}) });
        const res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/resources/${resourceType}/${type}?${params}`, {
          method: 'DELETE',
          headers: { Authorization: auth },
        });
        if (!res.ok) throw new Error(`Cloudinary refused to delete ${resourceType}/${type} under ${prefix} (${res.status})`);
        const body = (await res.json()) as { deleted?: Record<string, string>; next_cursor?: string; partial?: boolean };
        deleted += Object.values(body.deleted ?? {}).filter((v) => v === 'deleted').length;
        cursor = body.partial ? body.next_cursor : undefined;
      } while (cursor);
    }
  }
  return deleted;
}
