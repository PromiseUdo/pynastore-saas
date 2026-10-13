/*
 * Building the business app (ROADMAP 19.5): the kit's pure edits for it, the
 * pair of well-known files the business host serves so its links open the
 * app, the proxy letting phones fetch them, and http on a laptop in dev.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { allowHttpForDebug, editAndroidManifestForAppLinks, iosEntitlements, parseStoreAppConfig } from '@/scripts/mobile/native-project';
import { appleAppSiteAssociation, assetLinks, businessAppLinkSettings } from '@/lib/mobile/app-links';
import { BUSINESS_APP_ID } from '@/lib/mobile/app-config';
import { resolveBusinessRoute } from '@/lib/tenant/business';
import { getBusinessUrl } from '@/lib/tenant/urls';
import { GET as businessAasa } from '@/app/business/well-known/apple-app-site-association/route';
import { GET as businessAssetLinks } from '@/app/business/well-known/assetlinks.json/route';

const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const FINGERPRINT = '9B:BE:69:FA:77:AD:6A:AC:9F:46:67:89:B7:B9:F9:5D:1E:7D:25:C0:50:AA:E3:16:96:C1:A6:9F:D2:51:5B:3E';

const saved = { ...process.env };
afterEach(() => {
  for (const key of ['APPLE_TEAM_ID', 'APNS_BUSINESS_TEAM_ID', 'BUSINESS_APP_ANDROID_SHA256', 'NODE_ENV', 'NEXT_PUBLIC_ROOT_DOMAIN', 'NEXT_PUBLIC_BUSINESS_DOMAIN']) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('the business app’s build settings', () => {
  it('app.json for the business app is valid', () => {
    const parsed = parseStoreAppConfig({
      slug: 'business',
      appId: BUSINESS_APP_ID,
      name: 'Notely Business',
      version: '1.0.0',
      buildNumber: 0,
      serverUrl: 'https://b.getnotely.io',
    });
    expect('config' in parsed).toBe(true);
  });

  it('Android: links to the business host open the app — the whole host', () => {
    const out = editAndroidManifestForAppLinks(read('android/app/src/main/AndroidManifest.xml'), ['b.getnotely.io'], 'whole-host');
    expect(out).toContain('<data android:host="b.getnotely.io" />');
    expect(out).toContain('<data android:pathPrefix="/" />');
    expect(out).not.toContain('android:pathPrefix="/products"');
  });

  it('iPhone: the business host is its associated domain', () => {
    expect(iosEntitlements({ linkHosts: ['b.getnotely.io'] })).toContain('<string>applinks:b.getnotely.io</string>');
  });

  it('a debug build may load a laptop over http; the shared project never does by itself', () => {
    const plist = read('ios/App/App/Info.plist');
    expect(plist).not.toContain('NSAppTransportSecurity');
    const debug = allowHttpForDebug(plist);
    expect(debug).toMatch(/<key>NSAppTransportSecurity<\/key>\s*<dict>\s*<key>NSAllowsArbitraryLoads<\/key>\s*<true\/>/);
    expect(allowHttpForDebug(debug)).toBe(debug);
  });
});

describe('the business host’s link files', () => {
  it('iPhone: the whole host but /api, for the platform’s team — and nothing without a team', async () => {
    expect((await businessAasa()).status).toBe(404);
    process.env.APPLE_TEAM_ID = 'TEAM123456';
    const response = await businessAasa();
    expect(response.headers.get('content-type')).toBe('application/json');
    const body = await response.json();
    expect(body.applinks.details[0].appIDs).toEqual([`TEAM123456.${BUSINESS_APP_ID}`]);
    expect(body.applinks.details[0].components).toEqual([{ '/': '/api/*', exclude: true }, { '/': '*' }]);
  });

  it('Android: the keys in BUSINESS_APP_ANDROID_SHA256, and nothing without one', async () => {
    expect((await businessAssetLinks()).status).toBe(404);
    process.env.BUSINESS_APP_ANDROID_SHA256 = ` ${FINGERPRINT.replace(/:/g, '').toLowerCase()} , not-a-key`;
    expect(businessAppLinkSettings().fingerprints).toHaveLength(2);
    const [entry] = await (await businessAssetLinks()).json();
    expect(entry.target).toEqual({ namespace: 'android_app', package_name: BUSINESS_APP_ID, sha256_cert_fingerprints: [FINGERPRINT] });
  });

  it('a store’s files are unchanged: its shopping pages only', () => {
    const store = appleAppSiteAssociation({ appId: 'com.pynacode.shop', teamId: 'TEAM123456' })!;
    expect(store.applinks.details[0].components).toContainEqual({ '/': '/products/*' });
    expect(store.applinks.details[0].components).not.toContainEqual({ '/': '*' });
    expect(assetLinks({ appId: 'com.pynacode.shop', fingerprints: [] })).toBeNull();
  });

  it('phones fetch them without a session, and the rewritten pass goes through', () => {
    for (const signedIn of [false, true]) {
      expect(resolveBusinessRoute('/.well-known/apple-app-site-association', { signedIn, method: 'GET' })).toEqual({ kind: 'app-links' });
      expect(resolveBusinessRoute('/.well-known/assetlinks.json', { signedIn, method: 'GET' })).toEqual({ kind: 'app-links' });
      expect(resolveBusinessRoute('/business/well-known/assetlinks.json', { signedIn, method: 'GET' })).toEqual({ kind: 'pass' });
    }
  });
});

describe('a laptop in development', () => {
  it('links are http under next dev on a LAN name (nip.io), and https on a real domain', () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = '192-168-1-4.nip.io:3000';
    // @ts-expect-error - writable in tests
    process.env.NODE_ENV = 'development';
    expect(getBusinessUrl('/login')).toBe('http://b.192-168-1-4.nip.io:3000/login');
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'staging.example.com';
    expect(getBusinessUrl('/login')).toBe('https://b.staging.example.com/login');
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = '192-168-1-4.nip.io:3000';
    // @ts-expect-error - writable in tests
    process.env.NODE_ENV = 'production';
    expect(getBusinessUrl('/login')).toBe('https://b.192-168-1-4.nip.io:3000/login');
  });
});
