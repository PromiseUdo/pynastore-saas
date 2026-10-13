/*
 * lib/mobile/app-links.ts
 *
 * A store's links opening its own app instead of the browser (ROADMAP 18.5):
 * iOS Universal Links and Android App Links. Pure — the routes that serve the
 * two files, the build kit that stamps the hosts into the app, and the app
 * that routes an incoming link all read from here, so they can't disagree.
 *
 * How it works: the app says which hosts it handles (iOS entitlements,
 * Android intent filter); each host serves a file naming the app (iOS:
 * team + bundle id; Android: package + signing-key fingerprint); the phone
 * checks the two match when the app is installed. Without a match, links
 * just open the browser — nothing breaks.
 */
import { storefrontHostsFor } from '@/lib/tenant/resolveHostname';

/**
 * The store pages that open in the app: an allow-list, the same on both
 * phones. Android's link filter can only say which paths to take, never
 * which to leave, and taking the payment pages could catch the payment
 * provider's return mid-payment — those come back by the app's own scheme
 * (lib/mobile/deep-link.ts). So: the home page, and these prefixes. An order's
 * confirmation page, the link in every order email, is one of them;
 * checkout itself, invoices, /app and /api are not.
 */
export const APP_LINK_PREFIXES = [
  '/products',
  '/c',
  '/collections',
  '/sale',
  '/search',
  '/pages',
  '/cart',
  '/wishlist',
  '/account',
  '/chat',
  '/track-order',
  '/checkout/confirmation',
] as const;

/** Whether a store page at `path` belongs in the app. */
export function opensInApp(path: string): boolean {
  return path === '/' || APP_LINK_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * What to do with an https link the phone handed the app: the page to open
 * in it, or `browser` for one the app doesn't show (Android's filter is a
 * little wider than opensInApp — "/c" also takes "/cart-old"). Null when it
 * isn't an https link at all — a custom-scheme return, left to its flow.
 */
export function routeIncomingLink(url: string): { open: string } | { browser: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  return opensInApp(parsed.pathname) ? { open: `${parsed.pathname}${parsed.search}${parsed.hash}` } : { browser: parsed.href };
}

/** The hosts a store's app claims: its platform address, and its own domain when it has one. */
export function appLinkHosts(store: { slug: string; customStoreDomain?: string | null }): string[] {
  const hosts = [storefrontHostsFor(store.slug)[0]];
  if (store.customStoreDomain) hosts.push(store.customStoreDomain.toLowerCase());
  return hosts;
}

const TEAM_ID = /^[A-Z0-9]{10}$/;

/** /.well-known/apple-app-site-association, or null without a team id. */
export function appleAppSiteAssociation(app: { appId: string; teamId: string | null | undefined }) {
  if (!app.teamId || !TEAM_ID.test(app.teamId)) return null;
  const appId = `${app.teamId}.${app.appId}`;
  return {
    applinks: {
      details: [
        {
          appIDs: [appId],
          components: [{ '/': '/' }, ...APP_LINK_PREFIXES.flatMap((prefix) => [{ '/': prefix }, { '/': `${prefix}/*` }])],
          // iOS 12 and older read this form.
          appID: appId,
          paths: ['/', ...APP_LINK_PREFIXES.flatMap((prefix) => [prefix, `${prefix}/*`])],
        },
      ],
    },
  };
}

/** "aa bb …" or "AABB…" → "AA:BB:…", or null if it isn't a SHA-256 fingerprint. */
export function normalizeCertFingerprint(value: string): string | null {
  const hex = value.replace(/[\s:]/g, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  return hex.match(/../g)!.join(':');
}

/** /.well-known/assetlinks.json, or null without a fingerprint. */
export function assetLinks(app: { appId: string; fingerprints: string[] }) {
  const fingerprints = app.fingerprints.map(normalizeCertFingerprint).filter((f): f is string => f !== null);
  if (fingerprints.length === 0) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: app.appId, sha256_cert_fingerprints: fingerprints },
    },
  ];
}
