import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isOrgAsset, isOrgDocument, privateDownloadUrl, signDocumentUpload, signParams, signUpload } from './sign';
import { cloudinaryImage } from './url';

const config = { cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' };

describe('cloudinary signing', () => {
  it('signs sorted params per Cloudinary spec', () => {
    const expected = createHash('sha1').update('folder=a&timestamp=1secret').digest('hex');
    expect(signParams({ timestamp: 1, folder: 'a' }, 'secret')).toBe(expected);
  });

  it('pins uploads to the org folder', () => {
    const signed = signUpload('org1', 'products', config, 1_700_000_000_000);
    expect(signed.uploadUrl).toBe('https://api.cloudinary.com/v1_1/demo/image/upload');
    expect(signed.fields.folder).toBe('mansaas/org1/products');
    expect(signed.fields.signature).toBe(
      signParams({ allowed_formats: signed.fields.allowed_formats, folder: 'mansaas/org1/products', timestamp: 1_700_000_000 }, 'secret'),
    );
  });

  it('only accepts this org’s assets on this cloud', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/v1/mansaas/org1/products/abc.jpg';
    expect(isOrgAsset({ url, publicId: 'mansaas/org1/products/abc' }, 'org1', 'demo')).toBe(true);
    expect(isOrgAsset({ url, publicId: 'mansaas/org1/products/abc' }, 'org2', 'demo')).toBe(false);
    expect(isOrgAsset({ url, publicId: 'mansaas/org1/products/abc' }, 'org1', 'other')).toBe(false);
    expect(isOrgAsset({ url: 'https://evil.com/mansaas/org1/x.jpg', publicId: 'mansaas/org1/x' }, 'org1', 'demo')).toBe(false);
  });

  it('uploads documents privately, into the org’s verification folder, and signs the privacy', () => {
    const signed = signDocumentUpload('org1', config, 1_700_000_000_000);
    expect(signed.uploadUrl).toBe('https://api.cloudinary.com/v1_1/demo/image/upload');
    expect(signed.fields).toMatchObject({ folder: 'mansaas/org1/verification', type: 'private' });
    expect(signed.fields.allowed_formats).toContain('pdf');
    // `type` is inside the signature, so the browser can't turn it into a public upload.
    expect(signed.fields.signature).toBe(
      signParams(
        { allowed_formats: signed.fields.allowed_formats, folder: 'mansaas/org1/verification', timestamp: 1_700_000_000, type: 'private' },
        'secret',
      ),
    );
    expect(
      signed.fields.signature ===
        signParams({ allowed_formats: signed.fields.allowed_formats, folder: 'mansaas/org1/verification', timestamp: 1_700_000_000 }, 'secret'),
    ).toBe(false);
  });

  it('only accepts documents from this org’s verification folder', () => {
    expect(isOrgDocument('mansaas/org1/verification/abc', 'org1')).toBe(true);
    expect(isOrgDocument('mansaas/org1/verification/abc', 'org2')).toBe(false);
    expect(isOrgDocument('mansaas/org1/products/abc', 'org1')).toBe(false);
    expect(isOrgDocument('mansaas/org1/verification/../../org2/verification/x', 'org1')).toBe(false);
    expect(isOrgDocument('mansaas/org1/verification/a b?c', 'org1')).toBe(false);
  });

  it('makes a signed, expiring download link for a private document', () => {
    const url = new URL(privateDownloadUrl('mansaas/org1/verification/abc', 'pdf', { expiresInSeconds: 300 }, config, 1_700_000_000_000));
    expect(url.origin + url.pathname).toBe('https://api.cloudinary.com/v1_1/demo/image/download');
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({
      public_id: 'mansaas/org1/verification/abc',
      format: 'pdf',
      type: 'private',
      timestamp: '1700000000',
      expires_at: '1700000300',
      api_key: 'key',
    });
    expect(q.signature).toBe(
      signParams(
        { expires_at: 1_700_000_300, format: 'pdf', public_id: 'mansaas/org1/verification/abc', timestamp: 1_700_000_000, type: 'private' },
        'secret',
      ),
    );
  });

  it('builds transformed delivery URLs', () => {
    expect(cloudinaryImage('https://res.cloudinary.com/demo/image/upload/v1/a.jpg', { width: 80, height: 80 })).toBe(
      'https://res.cloudinary.com/demo/image/upload/c_fill,w_80,h_80,f_auto,q_auto/v1/a.jpg',
    );
    expect(cloudinaryImage('https://picsum.photos/a.jpg', { width: 80 })).toBe('https://picsum.photos/a.jpg');
  });
});
