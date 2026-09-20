# MansaaS Mobile App (Capacitor)

The customer **storefront** ships as a native iOS + Android app via Capacitor.
The **admin dashboard is never reachable or visible** inside the app.

---

## Architecture

### The problem

The web app is multi-tenant **by hostname** (`proxy.ts`):

| host | site |
|---|---|
| `{ROOT_DOMAIN}` | marketing / auth |
| `{slug}.{ROOT_DOMAIN}` | admin dashboard |
| `shop.{slug}.{ROOT_DOMAIN}` | storefront |
| custom domain | admin or storefront (DB lookup) |

A Capacitor app loads **one origin** (`server.url`) and the native bridge (plugins)
only works on that origin. Wildcard tenant subdomains can't be reproduced in a
WebView, and cross-subdomain navigation would kill the bridge.

### The solution — a dedicated single-origin "mobile" host

A new site type, **`mobile`**, served on `NEXT_PUBLIC_MOBILE_DOMAIN`
(dev: `m.app.localhost:3000`, prod e.g. `m.yourdomain.com`). On that host:

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

### Two tiers: mall (default) and branded (future)

`lib/mobile/app-config.ts` is the single seam between them. `proxy.ts` asks it
`resolveMobileRoute(pathname, getMobileApp())` and turns the answer into a
rewrite/redirect.

| | **mall** (default, every merchant) | **branded** (future premium add-on) |
|---|---|---|
| Config | nothing set | `NEXT_PUBLIC_MOBILE_APP_MODE=branded` + `NEXT_PUBLIC_MOBILE_APP_SLUG={slug}` at build time |
| `/` | store picker (`/m`) | opens straight into that store — no picker |
| `/s/{slug}` | any tenant's storefront | only the locked tenant; other slugs → home |
| Codebase | shared | **same shared codebase** — only the two env vars differ per build |
| Branding (logo, colours, fonts) | per-store, resolved in `app/store/[organizationSlug]/layout.tsx` | identical mechanism — nothing extra |

**Deliberately not built yet:** the per-merchant build/publish pipeline —
per-tenant `appId`, app icon, splash, signing, cert/provisioning management,
automated App Store / Play submission. `capacitor.config.ts` stays
`com.mansaas.app` / "MansaaS"; a branded build overrides those at generation
time later. Priority now is the mall experience.

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

The app is pinned to one origin, so Squad's payment page must not load in the
main WebView (it would be thrown out to the phone's browser and never return).
`lib/storefront/payments/open-payment-page.ts` opens it with **`@capacitor/browser`**
(SFSafariViewController / Chrome Custom Tabs) on top of the app instead. When
Squad finishes, `/api/payments/squad/callback` sees the attempt was started in
the app (`OrderPayment.nativeApp`) and answers with a small page that deep-links
to **`com.mansaas.app://payment-return`**; the app closes the sheet and opens the
order's confirmation page, which re-checks the payment with Squad. Closing the
sheet by hand does the same.

The scheme is registered in `ios/App/App/Info.plist` (`CFBundleURLTypes`) and
`android/app/src/main/AndroidManifest.xml` (intent filter using
`@string/custom_url_scheme`). A branded build with a different `appId` must
change both, and set `NEXT_PUBLIC_MOBILE_APP_SCHEME` to match.

## Running it

### Web (unchanged)

```
npm run dev
```
- Marketing: `http://app.localhost:3000`
- Admin: `http://{slug}.app.localhost:3000`
- Storefront: `http://shop.{slug}.app.localhost:3000`
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
   (e.g. `https://m.yourdomain.com`) plus `NEXT_PUBLIC_MOBILE_DOMAIN`
   (`m.yourdomain.com`).
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
