/*
 * The pure parts of ROADMAP 16.4: when a store's website offers its app,
 * which store a phone is sent to, what an order notification says, and the
 * token Apple wants. No database.
 */
import { generateKeyPairSync } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';
import { listingFor } from '@/lib/mobile/listing-rules';
import { bannerTarget } from '@/components/storefront/layout/get-app-banner';
import { isPlausiblePushToken, orderPushMessage } from '@/lib/mobile/push/messages';
import { apnsJwt, isUsableApnsKey } from '@/lib/mobile/push/apns';
import { pushPlatformFromUserAgent, userAgentHasPush } from '@/lib/mobile/app-config';

const APP = {
  name: 'Pynastore',
  appId: 'com.pynacode.shop',
  status: 'ACTIVE',
  appStoreId: '1234567890',
  onGooglePlay: true,
  promoteOnWebsite: true,
};

describe('when the website offers the app', () => {
  it('links each store it is really in', () => {
    expect(listingFor(APP)).toEqual({
      name: 'Pynastore',
      appStoreId: '1234567890',
      appStoreUrl: 'https://apps.apple.com/app/id1234567890',
      googlePlayUrl: 'https://play.google.com/store/apps/details?id=com.pynacode.shop',
    });
  });

  it('says nothing before a listing exists, once lapsed, or when the merchant turned it off', () => {
    expect(listingFor({ ...APP, appStoreId: null, onGooglePlay: false })).toBeNull();
    expect(listingFor({ ...APP, status: 'LAPSED' })).toBeNull();
    expect(listingFor({ ...APP, promoteOnWebsite: false })).toBeNull();
  });

  it('offers only the store that has it', () => {
    expect(listingFor({ ...APP, appStoreId: null })).toMatchObject({ appStoreUrl: null, googlePlayUrl: expect.any(String) });
  });
});

describe('the phone banner', () => {
  const listing = listingFor(APP)!;
  it('sends Android to Google Play', () => {
    expect(bannerTarget('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/129 Mobile', listing)?.store).toBe('Google Play');
  });
  it("leaves iPhone Safari to Apple's own banner, and sends other iPhone browsers to the App Store", () => {
    expect(bannerTarget('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1', listing)).toBeNull();
    expect(bannerTarget('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/129.0 Mobile/15E148', listing)?.store).toBe('App Store');
  });
  it('shows nothing on a computer, or for a phone whose store has no listing', () => {
    expect(bannerTarget('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/129', listing)).toBeNull();
    expect(bannerTarget('Mozilla/5.0 (Linux; Android 15)', { ...listing, googlePlayUrl: null })).toBeNull();
  });
});

describe('order notifications', () => {
  it('state what changed, from the store', () => {
    expect(orderPushMessage('shipped', { storeName: 'Pynastore', reference: 'PN-1001' })).toEqual({
      title: 'Pynastore',
      body: 'Order PN-1001 is on its way.',
    });
  });
  it('are not sent for what the shopper just did themselves', () => {
    for (const kind of ['placed-pay-on-delivery', 'placed-bank-transfer', 'cancelled-by-you', 'return-requested'] as const) {
      expect(orderPushMessage(kind, { storeName: 'S', reference: 'R' })).toBeNull();
    }
  });
  it('accept only tokens shaped like the platform’s', () => {
    expect(isPlausiblePushToken('IOS', 'ab'.repeat(32))).toBe(true);
    expect(isPlausiblePushToken('IOS', 'not-hex')).toBe(false);
    expect(isPlausiblePushToken('ANDROID', `dXk:${'A'.repeat(140)}`)).toBe(true);
    expect(isPlausiblePushToken('ANDROID', '<script>')).toBe(false);
  });
  it('read the build and phone from the user agent', () => {
    expect(userAgentHasPush('… MansaasApp/com.a.b MansaasPush')).toBe(true);
    expect(userAgentHasPush('… MansaasApp/com.a.b')).toBe(false);
    expect(userAgentHasPush('… NotMansaasPush')).toBe(false);
    expect(pushPlatformFromUserAgent('Mozilla/5.0 (Linux; Android 15)')).toBe('ANDROID');
    expect(pushPlatformFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)')).toBe('IOS');
    expect(pushPlatformFromUserAgent('Mozilla/5.0 (Macintosh)')).toBeNull();
  });
});

describe("Apple's provider token", () => {
  const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  it('is ES256, issued by the team, named by the key id, and reused for 40 minutes', async () => {
    const now = Date.now();
    const jwt = await apnsJwt({ teamId: 'ABCDE12345', keyId: 'KEY1234567', key }, now);
    expect(decodeProtectedHeader(jwt)).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    expect(decodeJwt(jwt)).toMatchObject({ iss: 'ABCDE12345' });
    await expect(apnsJwt({ teamId: 'ABCDE12345', keyId: 'KEY1234567', key }, now + 30 * 60_000)).resolves.toBe(jwt);
    await expect(apnsJwt({ teamId: 'ABCDE12345', keyId: 'KEY1234567', key }, now + 41 * 60_000)).resolves.not.toBe(jwt);
  });

  it('refuses a file that is not an APNs key', async () => {
    await expect(isUsableApnsKey(key)).resolves.toBe(true);
    await expect(isUsableApnsKey('-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----')).resolves.toBe(false);
  });
});
