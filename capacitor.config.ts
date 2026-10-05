/*
 * capacitor.config.ts — native shell configuration for the Notely
 * storefront mobile app (iOS + Android).
 *
 * The app has no bundled web build: it is a thin native wrapper around the
 * live storefront, loaded over `server.url`. See MOBILE.md for the full
 * architecture rationale.
 *
 * `server.url` is resolved in this order:
 *   1. CAP_SERVER_URL  — set automatically by `cap run … --live-reload
 *      --external` (points at your dev machine's LAN IP). Dev only.
 *   2. NEXT_PUBLIC_MOBILE_URL — the deployed mobile origin
 *      (e.g. https://m.example.com). Used for TestFlight / Play builds.
 *   3. nothing — the app falls back to the offline page in `mobile/www`.
 *
 * One config builds every app (ROADMAP 16): the shared one by default, or a
 * store's own app when the build sets MOBILE_APP_ID and MOBILE_APP_NAME
 * (the store build kit, 16.3, also rewrites the native projects to match —
 * the native projects embed the id, so changing it here alone isn't enough).
 *
 * Every build appends `MansaasApp/{appId}` to its WebView's user agent. That
 * is how the one mobile origin tells a store's app from the shared one and
 * locks it to its store (lib/mobile/app-config.ts). The app id is also the
 * app's URL scheme, which payments and Google sign-in deep-link back to.
 */
import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const liveReloadUrl = process.env.CAP_SERVER_URL?.trim();
const productionUrl = process.env.NEXT_PUBLIC_MOBILE_URL?.trim();
const serverUrl = liveReloadUrl || productionUrl || undefined;

// The shared app's id is permanent — changing it makes a different app in the
// stores, so it keeps the original name. Its display name follows
// lib/brand.ts (12.2). A store's app brings its own (16.3).
const appId = process.env.MOBILE_APP_ID?.trim() || 'com.mansaas.app';
const appName = process.env.MOBILE_APP_NAME?.trim() || 'Notely';

// Must match APP_USER_AGENT_TOKEN / PUSH_USER_AGENT_TOKEN in lib/mobile/app-config.ts.
// A build says it can receive push only when the store-app build kit made it
// with push (ROADMAP 16.4): on Android that needs the Firebase config inside.
const marker = `MansaasApp/${appId}`;
const withPush = (on: boolean) => (on ? `${marker} MansaasPush` : marker);

const config: CapacitorConfig = {
  appId,
  appName,
  appendUserAgent: marker,
  // Required even though we load over the network — Capacitor copies this
  // into the native bundle as the offline fallback.
  webDir: 'mobile/www',

  server: {
    // When undefined, Capacitor serves `webDir` (the offline page).
    url: serverUrl,
    // Local dev servers are http:// — allow cleartext for live reload only.
    cleartext: Boolean(liveReloadUrl),
    androidScheme: 'https',
    iosScheme: 'https',
    // Shown when the live store can't be reached (no connection, or a server
    // error) instead of the platform's blank error screen — mobile/www.
    errorPath: 'offline.html',
  },

  ios: {
    appendUserAgent: withPush(process.env.MOBILE_APP_PUSH_IOS === '1'),
    // Respect the safe-area insets ourselves via CSS env() rather than
    // letting WKWebView inset the whole viewport.
    contentInset: 'never',
    backgroundColor: '#ffffff',
  },
  android: {
    appendUserAgent: withPush(process.env.MOBILE_APP_PUSH_ANDROID === '1'),
    backgroundColor: '#ffffff',
  },

  plugins: {
    SplashScreen: {
      // We hide the splash from JS once the first storefront paint lands
      // (see components/native/native-shell.tsx) so there is no white flash.
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: '#ffffff',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      overlaysWebView: false,
      style: 'DEFAULT',
      backgroundColor: '#ffffff',
    },
    PushNotifications: {
      // An order update arriving while the app is open still shows.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Keyboard: {
      // 'native' lets the OS resize the WebView; combined with our
      // .keyboard-open CSS hook this keeps inputs visible.
      resize: KeyboardResize.Native,
      resizeOnFullScreen: true,
    },
  },
};

export default config;
