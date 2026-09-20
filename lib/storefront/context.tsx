'use client';

/*
 * Storefront runtime context: the active org's public identity plus the
 * client runtime flag (web vs the Capacitor/mobile origin). Provided once
 * by the storefront layout; consumed by header, footer, share, etc.
 */
import * as React from 'react';
import { setActiveOrg } from './stores/storage';

export interface StorefrontOrg {
  slug: string;
  name: string;
  logoUrl: string | null;
}

/*
 * The signed-in shopper, as the client needs them: a name to greet, an email
 * to show, and nothing else. Resolved on the server in the storefront layout
 * (lib/storefront/account/session.ts) and passed down, so the header renders
 * signed-in on the FIRST paint — a header that flashes "Sign in" and then
 * corrects itself reads as a bug to the person who just signed in.
 */
export interface StorefrontShopper {
  id: string;
  name: string;
  firstName: string;
  email: string;
}

interface StorefrontContextValue {
  org: StorefrontOrg;
  /** true on the dedicated mobile origin or inside the native shell */
  isMobileRuntime: boolean;
  /** null when nobody is signed in — browsing never requires an account */
  shopper: StorefrontShopper | null;
}

const StorefrontContext = React.createContext<StorefrontContextValue | null>(null);

export function StorefrontProvider({
  org,
  isMobileRuntime,
  shopper = null,
  children,
}: {
  org: StorefrontOrg;
  isMobileRuntime: boolean;
  shopper?: StorefrontShopper | null;
  children: React.ReactNode;
}) {
  // Stamp the org slug for the persisted zustand stores and re-read any that
  // hydrated before it existed — during render, so before any child renders
  // or writes (see lib/storefront/stores/storage.ts).
  setActiveOrg(org.slug);

  const value = React.useMemo(
    () => ({ org, isMobileRuntime, shopper }),
    [org, isMobileRuntime, shopper],
  );

  return <StorefrontContext.Provider value={value}>{children}</StorefrontContext.Provider>;
}

export function useStorefront(): StorefrontContextValue {
  const ctx = React.useContext(StorefrontContext);
  if (!ctx) throw new Error('useStorefront must be used within <StorefrontProvider>');
  return ctx;
}

/** The signed-in shopper, or null. */
export function useShopper(): StorefrontShopper | null {
  return useStorefront().shopper;
}

/** True once the component has mounted on the client — for hydration-safe
 *  rendering of cart counts, wishlist badges, etc. */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);
  return hydrated;
}
