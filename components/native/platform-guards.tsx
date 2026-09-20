'use client';

/*
 * components/native/platform-guards.tsx
 *
 * Render-time guards for the mobile experience. Hydration-safe: both render
 * `null` on the first pass and reconcile after the platform effect runs.
 *
 * Convention: any admin-only link, menu item, or navigation that could
 * appear in shared storefront UI must be wrapped in <WebOnly>. The
 * authoritative block is server-side in proxy.ts — these are defense in
 * depth and keep the UI clean.
 */
import type { ReactNode } from 'react';
import { useNativePlatform } from '@/lib/platform';

/** Renders children only when NOT in the mobile runtime (native app or mobile web origin). */
export function WebOnly({ children }: { children: ReactNode }) {
  const { isMobileRuntime, ready } = useNativePlatform();
  if (!ready || isMobileRuntime) return null;
  return <>{children}</>;
}

/** Renders children only in the mobile runtime. */
export function NativeOnly({ children }: { children: ReactNode }) {
  const { isMobileRuntime, ready } = useNativePlatform();
  if (!ready || !isMobileRuntime) return null;
  return <>{children}</>;
}
