import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isOrgAsset, signParams, signUpload } from './sign';
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

  it('builds transformed delivery URLs', () => {
    expect(cloudinaryImage('https://res.cloudinary.com/demo/image/upload/v1/a.jpg', { width: 80, height: 80 })).toBe(
      'https://res.cloudinary.com/demo/image/upload/c_fill,w_80,h_80,f_auto,q_auto/v1/a.jpg',
    );
    expect(cloudinaryImage('https://picsum.photos/a.jpg', { width: 80 })).toBe('https://picsum.photos/a.jpg');
  });
});
