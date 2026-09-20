/*
 * lib/platform/native.ts
 *
 * SSR-safe platform detection. Every helper works on the server (where the
 * Capacitor global is absent) and in a normal browser tab — they just
 * report "web". Only inside the Capacitor WebView do they report ios/android.
 *
 * Import these anywhere. For rendering decisions in Client Components,
 * prefer the hydration-safe `useNativePlatform()` hook so the first render
 * matches the server output.
 */
import { Capacitor } from '@capacitor/core';

export type Platform = 'ios' | 'android' | 'web';

/** True only inside the Capacitor native runtime (iOS/Android WebView). */
export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getPlatform(): Platform {
  try {
    const p = Capacitor.getPlatform();
    return p === 'ios' || p === 'android' ? p : 'web';
  } catch {
    return 'web';
  }
}

export function isIOS(): boolean {
  return getPlatform() === 'ios';
}

export function isAndroid(): boolean {
  return getPlatform() === 'android';
}

/**
 * True when the current document is the storefront running as a mobile
 * experience — either the native app, or a browser hitting the dedicated
 * mobile origin (proxy.ts stamps `<html data-runtime="mobile">` via the
 * `x-runtime` header). Use this to hide admin affordances.
 */
export function isMobileRuntime(): boolean {
  if (isNativePlatform()) return true;
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.runtime === 'mobile';
}
