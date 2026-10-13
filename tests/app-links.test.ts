/*
 * A store's links opening its own app (ROADMAP 18.5): the rules, the two
 * files phones check, and the routes that serve them per store.
 *
 *   - the same allow-list decides for both phones and for the app itself:
 *     store pages and an order's confirmation open the app, checkout's
 *     payment pages, invoices and /api never do;
 *   - each file names exactly this store's app, and only a live one;
 *   - without a team id or a signing key there is no file, and links simply
 *     open the browser.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createTestStores, pinDomains } from './helpers/storefront-requests';
import {
  appLinkHosts,
  appleAppSiteAssociation,
  assetLinks,
  normalizeCertFingerprint,
  opensInApp,
  routeIncomingLink,
} from '@/lib/mobile/app-links';
import { GET as aasa } from '@/app/store/[organizationSlug]/well-known/apple-app-site-association/route';
import { GET as assetlinks } from '@/app/store/[organizationSlug]/well-known/assetlinks.json/route';

pinDomains();

const SUFFIX = Math.random().toString(36).slice(2, 8);
const FINGERPRINT = 'ab'.repeat(32);
const FORMATTED = 'AB:'.repeat(31) + 'AB';
let store = { id: '', slug: '' };
let cleanup = async () => {};

const params = (organizationSlug: string) => ({ params: Promise.resolve({ organizationSlug }) });

beforeAll(async () => {
  const made = await createTestStores('__test-applinks', 1);
  cleanup = made.cleanup;
  [store] = made.stores;
}, 60_000);

afterAll(async () => {
  await cleanup(); // the app goes with the store
}, 60_000);

describe('which links open the app', () => {
  it('takes store pages and an order’s confirmation, and leaves payment, invoices and /api to the browser', () => {
    for (const path of ['/', '/products/red-shoe', '/account/orders/R-1', '/chat', '/checkout/confirmation', '/c/shoes', '/cart']) {
      expect(opensInApp(path), path).toBe(true);
    }
    for (const path of ['/checkout', '/checkout/pay', '/invoice/abc', '/api/storefront/chat', '/app', '/cartwheel']) {
      expect(opensInApp(path), path).toBe(false);
    }
  });

  it('opens the page in the app, sends anything else to the browser, and ignores a custom-scheme return', () => {
    expect(routeIncomingLink('https://shop-a.example.com/checkout/confirmation?t=abc')).toEqual({ open: '/checkout/confirmation?t=abc' });
    expect(routeIncomingLink('https://shop-a.example.com/invoice/9')).toEqual({ browser: 'https://shop-a.example.com/invoice/9' });
    expect(routeIncomingLink('com.pynacode.shop://payment-return?ref=x')).toBeNull();
    expect(routeIncomingLink('not a url')).toBeNull();
  });

  it('claims the platform address, and the store’s own domain when it has one', () => {
    expect(appLinkHosts({ slug: 'acme' })).toEqual(['shop-acme.app.localhost:3000']);
    expect(appLinkHosts({ slug: 'acme', customStoreDomain: 'WWW.Acme.ng' })).toEqual(['shop-acme.app.localhost:3000', 'www.acme.ng']);
  });
});

describe('the files phones check', () => {
  it('names the app by team and bundle id for iPhones, in both formats', () => {
    const file = appleAppSiteAssociation({ appId: 'com.acme.shop', teamId: 'ABCDE12345' })!;
    const details = file.applinks.details[0];
    expect(details.appIDs).toEqual(['ABCDE12345.com.acme.shop']);
    expect(details.appID).toBe('ABCDE12345.com.acme.shop');
    expect(details.components).toContainEqual({ '/': '/checkout/confirmation/*' });
    expect(details.paths).not.toContain('/checkout/*');
    expect(appleAppSiteAssociation({ appId: 'com.acme.shop', teamId: null })).toBeNull();
    expect(appleAppSiteAssociation({ appId: 'com.acme.shop', teamId: 'not-a-team' })).toBeNull();
  });

  it('names the app by package and signing key for Android', () => {
    expect(normalizeCertFingerprint(FINGERPRINT)).toBe(FORMATTED);
    expect(normalizeCertFingerprint('AB:CD')).toBeNull();
    expect(assetLinks({ appId: 'com.acme.shop', fingerprints: [FINGERPRINT, 'junk'] })).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'com.acme.shop', sha256_cert_fingerprints: [FORMATTED] },
      },
    ]);
    expect(assetLinks({ appId: 'com.acme.shop', fingerprints: [] })).toBeNull();
  });
});

describe('serving them per store', () => {
  it('has nothing to say for a store without an app, or without the keys', async () => {
    expect((await aasa(new Request('http://x'), params(store.slug))).status).toBe(404);
    await prisma.mobileApp.create({ data: { organizationId: store.id, appId: `com.links${SUFFIX}.shop`, name: 'Links' } });
    expect((await aasa(new Request('http://x'), params(store.slug))).status).toBe(404);
    expect((await assetlinks(new Request('http://x'), params(store.slug))).status).toBe(404);
  });

  it('serves this store’s app once it’s recorded, and stops when the app lapses', async () => {
    await prisma.mobileApp.update({ where: { organizationId: store.id }, data: { appleTeamId: 'ABCDE12345', androidCertSha256: [FORMATTED] } });

    const ios = await aasa(new Request('http://x'), params(store.slug));
    expect(ios.headers.get('content-type')).toBe('application/json');
    expect(((await ios.json()) as { applinks: { details: { appIDs: string[] }[] } }).applinks.details[0].appIDs).toEqual([`ABCDE12345.com.links${SUFFIX}.shop`]);
    const android = (await (await assetlinks(new Request('http://x'), params(store.slug))).json()) as { target: { package_name: string } }[];
    expect(android[0].target.package_name).toBe(`com.links${SUFFIX}.shop`);

    await prisma.mobileApp.update({ where: { organizationId: store.id }, data: { status: 'LAPSED' } });
    expect((await aasa(new Request('http://x'), params(store.slug))).status).toBe(404);
  });
});
