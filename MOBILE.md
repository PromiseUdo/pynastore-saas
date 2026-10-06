# Notely Mobile App (Capacitor)

> The platform's working name is **Notely** (`lib/brand.ts`, ROADMAP 12.2). The app's
> display name follows it; its id stays `com.mansaas.app`, because changing an app id makes a
> different app in the stores.

The customer **storefront** ships as a native iOS + Android app via Capacitor.
The **admin dashboard is never reachable or visible** inside the app.

---

## Architecture

### The problem

The web app is multi-tenant **by hostname** (`proxy.ts`):

| host | site |
|---|---|
| `{ROOT_DOMAIN}`, `www.` | marketing |
| `{PLATFORM_HOST}` (prod: `app.{ROOT_DOMAIN}`) | platform / auth |
| `{slug}.{ROOT_DOMAIN}` | admin dashboard |
| `shop-{slug}.{ROOT_DOMAIN}` | storefront |
| custom domain | admin or storefront (DB lookup) |

A Capacitor app loads **one origin** (`server.url`) and the native bridge (plugins)
only works on that origin. Wildcard tenant subdomains can't be reproduced in a
WebView, and cross-subdomain navigation would kill the bridge.

### The solution — a dedicated single-origin "mobile" host

A new site type, **`mobile`**, served on `NEXT_PUBLIC_MOBILE_DOMAIN`
(dev: `m.app.localhost:3000`, prod: `m.getnotely.io`). On that host:

- The org slug travels **in the path**: `/s/{slug}/...`
- `proxy.ts` rewrites `/s/{slug}/...` → the existing `app/store/[organizationSlug]`
  route tree (**no storefront code is duplicated**).
- `/` → `/m`, a minimal **store-picker stub** (`app/(mobile)/m/page.tsx`).
- **Every other path (all admin/dashboard/marketing routes) → redirect to `/`.**
  This is the authoritative, server-side admin block. The app only ever talks to
  this one origin, so admin code physically never routes to it.
- One origin ⇒ the Capacitor bridge stays alive across the whole storefront.
- In **development**, any unrecognized host (a LAN IP from `--live-reload
  --external`) is also treated as `mobile`, so on-device live reload needs no setup.

`server.url` is resolved in `capacitor.config.ts` as:
`CAP_SERVER_URL` (live reload) → `NEXT_PUBLIC_MOBILE_URL` (release) → offline page
(`mobile/www/index.html`).

**Why not `output: 'export'`?** Multi-tenant SSR + Prisma in `proxy.ts`/layouts +
Auth.js cannot be statically bundled. If a single-tenant offline catalog is ever
wanted, gate `output` behind a `BUILD_TARGET=mobile` env check — the plumbing here
doesn't change.

### Two kinds of app: the shared one and a store's own (ROADMAP 16)

One deployment serves every app. Each build appends `MansaasApp/{appId}` to its
WebView's user agent (`capacitor.config.ts`, `appendUserAgent`). On the mobile
origin, `proxy.ts` reads it through `lib/mobile/store-apps.ts` and routes with
`resolveMobileRoute` (`lib/mobile/app-config.ts`):

| | **shared app** (`com.mansaas.app`, or no marker) | **a store's own app** (registered in `MobileApp`) |
|---|---|---|
| `/` | store picker (`/m`) | opens straight into that store — no picker |
| `/s/{slug}` | any store | only its store; other slugs → home |
| Add-on lapsed / build not registered | — | every path → "This app is no longer available" (`/m/app-unavailable`), linking to the store's website |
| Branding (logo, colours, fonts) | per-store, from `app/store/[organizationSlug]/layout.tsx` | the same — nothing extra |

The environment variables `NEXT_PUBLIC_MOBILE_APP_MODE` / `_SLUG` are gone:
they were read by the server, so they locked a whole deployment to one store.

**The app id is also the app's URL scheme** (`com.pynacode.shop://…`).
Payments and Google sign-in deep-link back to the app a shopper is using; the
server only deep-links to the shared id or a registered, active one.

**Records** — until the platform console has screens for them (16.2):

```
npx tsx prisma/mobile-app.ts register <store-slug> <app-id> "<App name>"
npx tsx prisma/mobile-app.ts lapse|restore <store-slug>
npx tsx prisma/mobile-app.ts list
```

**Building a store's app:** `MOBILE_APP_ID` and `MOBILE_APP_NAME` set the id,
name and user-agent marker in `capacitor.config.ts`. The native projects embed
the id too (bundle id, `applicationId`, the URL scheme in `Info.plist` and
`strings.xml`); the build kit (`npm run mobile:app`, ROADMAP 16.3) rewrites
those in a copy — never change the committed `android/` and `ios/` projects
for one store. The runbook is [docs/MOBILE-BUILD.md](docs/MOBILE-BUILD.md).

### What a store's own app adds (ROADMAP 16.4)

- **Order notifications.** Offered only on an order's page, and only in a
  store app built with push (`MansaasPush` in its user agent) that the server
  can reach. Android goes through the platform's Firebase project
  (`FIREBASE_SERVICE_ACCOUNT`). iPhone goes straight to APNs with the
  merchant's own key, sealed on `MobileApp`. A device is linked only to the
  orders it asked about (`PushOrderWatch`), for 60 days. Sent beside the order
  email (`lib/storefront/orders/notifications.ts` → `lib/mobile/push/send.ts`).
  Tapping one opens the order (`components/native/native-shell.tsx`).
- **Share** on product pages uses the phone's share sheet (`@capacitor/share`),
  and always shares the store's public web address.
- **Offline screen.** `server.errorPath` shows `mobile/www/offline.html`, which
  the build kit stamps with the app's name and address.
- **On the store's website:** "Get our app" (phone banner, footer link, `/app`
  with a QR code) and Safari's own Smart App Banner. These appear only once a
  listing is recorded (`lib/mobile/listing.ts`).
- **Links inside a store app.** The storefront's links are slug-free
  (`/products/x`). In a store's own app every such path is that store's page.
  **In the shared app they still bounce to the picker**, since nothing tells
  the server which store a bare path belongs to. Fixing that is part of the
  real store picker.

### On a phone (ROADMAP 16.5)

Every phone-width screen — the app and phone browsers — gets the app layout:
the header is only a search box, the bottom tab bar is the navigation (Home,
Shop, Saved, Bag, Account → `/account/menu`), and there's no footer, utility
strip or features band. The page starts below the status bar via
`--inset-top` (globals.css), which reads Capacitor's `--safe-area-inset-*`
variables as well as `env()`: Android 15+ draws apps under the status bar.

### Native polish

- `components/native/native-shell.tsx` (mounted once in `app/layout.tsx`): hides the
  splash screen after first paint, configures the status bar (light/dark aware),
  toggles `.keyboard-open` on `<html>` around the keyboard, and handles the Android
  hardware back button (history back, or exit at the storefront root). No-op on web.
- `app/layout.tsx` `viewport` export: `viewport-fit=cover`, no user zoom, theme
  colour.
- `app/globals.css`: `.safe-top/.safe-bottom/.safe-y/.safe-x` inset utilities;
  native-only rules that disable overscroll bounce, tap highlight, and text-size
  adjust (inputs stay selectable).
- `lib/platform/` — `isNativePlatform()`, `getPlatform()`, `isIOS()`, `isAndroid()`,
  `isMobileRuntime()`, and the hydration-safe `useNativePlatform()` hook.
- `components/native/platform-guards.tsx` — `<WebOnly>` / `<NativeOnly>` wrappers.
  **Convention:** wrap any admin link/menu that could render in shared storefront UI
  in `<WebOnly>`.

---

### Payments inside the app

The app is pinned to one origin, so Paystack's payment page must not load in the
main WebView (it would be thrown out to the phone's browser and never return).
`lib/storefront/payments/open-payment-page.ts` opens it with **`@capacitor/browser`**
(SFSafariViewController / Chrome Custom Tabs) on top of the app instead. When
Paystack finishes, `/api/payments/paystack/callback` sees the attempt was started in
the app (`OrderPayment.nativeApp`) and answers with a small page that deep-links
to **`com.mansaas.app://payment-return`**; the app closes the sheet and opens the
order's confirmation page, which re-checks the payment with Paystack. Closing the
sheet by hand does the same.

The deep link uses the scheme of the app the payment began in
(`OrderPayment.nativeAppScheme`, worked out from the user-agent marker when the
payment starts), so a store's own app gets its shoppers back, not the shared
app. Attempts from before ROADMAP 16.1 use the shared scheme.

The scheme is registered in `ios/App/App/Info.plist` (`CFBundleURLTypes`) and
`android/app/src/main/AndroidManifest.xml` (intent filter using
`@string/custom_url_scheme`). A store's app registers its own id there.

### Google sign-in inside the app

Google refuses sign-in inside an embedded WebView, so in the app "Continue
with Google" opens in the same in-app browser sheet
(`lib/storefront/account/native-google.ts`). The callback deep-links back with
`{appId}://auth-return?to={handoff link}`; the app closes the sheet and opens
the handoff link in its own WebView — the sheet doesn't share cookies with it,
so that's where the session cookie must be set. The one-minute handoff ticket
is bound to a challenge whose verifier never leaves the WebView (PKCE-style,
RFC 8252), so another app that claims the same scheme can't use a caught link.

## Running it

### Web (unchanged)

```
npm run dev
```
- Marketing: `http://app.localhost:3000`
- Admin: `http://{slug}.app.localhost:3000`
- Storefront: `http://shop-{slug}.app.localhost:3000`
- Mobile origin (browser preview): `http://m.app.localhost:3000` → picker;
  `http://m.app.localhost:3000/s/{slug}` → storefront;
  `http://m.app.localhost:3000/dashboard` → redirected to picker (admin blocked).

### One-time native setup

```
npx cap add ios
npx cap add android
```
`ios/` and `android/` are committed; only build artifacts are gitignored.

### iOS simulator

```
npm run cap:copy        # push web config into the native project
npm run mobile:ios       # build + launch on a simulator (or: npm run cap:open:ios)
```

### Android emulator

```
npm run cap:copy
npm run mobile:android   # or: npm run cap:open:android
```

### Live reload (edit web code, see it update on device/simulator)

Terminal 1:
```
npm run dev:mobile       # next dev bound to 0.0.0.0
```
Terminal 2:
```
npm run mobile:ios:live       # or mobile:android:live
```
`--external` makes the Capacitor CLI pick your LAN IP and set `CAP_SERVER_URL`.
If Next blocks HMR, add that IP to `allowedDevOrigins` in `next.config.ts`.

### Test on a physical Android phone (no deploy needed)

The phone loads the dev server over your Wi-Fi, so both must be on the same network.

```
npm run dev:mobile                                           # Terminal 1 — keep running
CAP_SERVER_URL=http://<your-LAN-IP>:3000 npx cap sync android  # macOS: ipconfig getifaddr en0
cd android && ./gradlew assembleDebug                        # → app/build/outputs/apk/debug/app-debug.apk
```
Without `CAP_SERVER_URL` (or `NEXT_PUBLIC_MOBILE_URL`) the APK has no server and
always shows the bundled "You're offline" page. Debug builds allow http
(`usesCleartextTraffic` placeholder in `android/app/build.gradle`); release builds don't.
If your LAN IP changes, re-run the sync + build.

### Production build

1. Deploy the app with a real mobile origin and set `NEXT_PUBLIC_MOBILE_URL`
   (`https://m.getnotely.io`) plus `NEXT_PUBLIC_MOBILE_DOMAIN`
   (`m.getnotely.io`). Both are build-time: changing them needs a native
   rebuild and a store release before installed apps follow, so keep the old
   mobile origin serving until that release has been adopted.
2. `npm run cap:sync`
3. iOS: open in Xcode (`npm run cap:open:ios`), set signing, Archive.
   Android: `npm run cap:open:android`, Build → Generate Signed Bundle.

---

## What changed

**New:** `capacitor.config.ts`, `mobile/www/index.html`, `lib/platform/*`,
`lib/mobile/app-config.ts`, `components/native/*`, `app/(mobile)/*`,
`.env.example`, `tests/mobile-hostname.test.ts`, `tests/mobile-route.test.ts`,
`ios/`, `android/`.

**Modified:** `proxy.ts` (mobile branch, before the auth gate — storefront browsing
is public), `lib/tenant/resolveHostname.ts` (`mobile` site type + dev LAN-IP
fallback), `lib/tenant/resolveTenant.ts` (`resolveTenantBySlug`),
`lib/tenant/urls.ts` (`getMobileUrl`, `getMobileStorefrontUrl`), `app/layout.tsx`
(viewport, `<NativeShell/>`, `data-runtime`), `app/globals.css`, `next.config.ts`,
`package.json` (mobile scripts), `.gitignore`, `.env`.

**Untouched:** everything under `app/(dashboard)/`, `app/(auth)/`, admin components,
Auth.js core. Existing web behaviour on existing hosts is unchanged (`npm test`
green).

## Known follow-ups (out of scope here)

- The real store picker (recent stores, search, branding, deep links).
- `/api/*` routes are excluded from `proxy.ts` — when the storefront calls its own
  APIs from the mobile origin they won't get tenant headers from the proxy; the API
  handlers will need to accept the slug explicitly.
- App icons / splash images: drop source assets in and run `@capacitor/assets`.
- A store's own app (ROADMAP 16): the console side (16.2) and approval-ready
  extras such as push notifications (16.4).
