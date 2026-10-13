/*
 * public/sw.js — the one service worker, on every host we serve: a shop's
 * admin, the platform console, a storefront, a custom domain (ROADMAP 18.3).
 * proxy.ts lets it through untouched (its matcher skips /sw.js).
 *
 * It does two things and nothing else — no caching, no offline pages:
 *
 *   push               show the notification the server sent
 *                      (lib/notifications/channels/web-push.ts: title, body,
 *                      url, tag) and set the app's badge where supported;
 *   notificationclick  open its page: focus a tab of this site and take it
 *                      there, or open one. Only a page on THIS origin is
 *                      ever opened — anything else opens the site's home.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'New notification';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    data: { url: sameOrigin(data.url) },
  };
  // Same thread (an order, a chat): replace the one already showing, and still buzz.
  if (typeof data.tag === 'string' && data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      self.navigator && 'setAppBadge' in self.navigator ? self.navigator.setAppBadge().catch(() => {}) : Promise.resolve(),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = sameOrigin(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      if (self.navigator && 'clearAppBadge' in self.navigator) await self.navigator.clearAppBadge().catch(() => {});
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        if ('navigate' in open) {
          await open.navigate(url).catch(() => self.clients.openWindow(url));
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

/** An absolute URL on this origin, or this origin's home. */
function sameOrigin(value) {
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? url.href : self.location.origin + '/';
  } catch {
    return self.location.origin + '/';
  }
}
