/*
 * capacitor.config.ts — native shell configuration for the MansaaS
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
 * appId / appName are safe to rename before the first `cap add` — do it
 * there, not after (the native projects embed the id).
 */
import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const liveReloadUrl = process.env.CAP_SERVER_URL?.trim();
const productionUrl = process.env.NEXT_PUBLIC_MOBILE_URL?.trim();
const serverUrl = liveReloadUrl || productionUrl || undefined;

const config: CapacitorConfig = {
  appId: 'com.mansaas.app',
  appName: 'MansaaS',
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
  },

  ios: {
    // Respect the safe-area insets ourselves via CSS env() rather than
    // letting WKWebView inset the whole viewport.
    contentInset: 'never',
    backgroundColor: '#ffffff',
  },
  android: {
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
    Keyboard: {
      // 'native' lets the OS resize the WebView; combined with our
      // .keyboard-open CSS hook this keeps inputs visible.
      resize: KeyboardResize.Native,
      resizeOnFullScreen: true,
    },
  },
};

export default config;
