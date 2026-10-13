'use client';

/*
 * "No buying in the app" (ROADMAP 19.0, 19.3). In the business app nothing
 * is sold and nothing points to where it could be bought: Apple lets a free
 * companion app to a paid web service skip in-app purchase only on those
 * terms (App Review 3.1.3(f)), and Google Play is read the same way.
 *
 * Decided once per request on the server, from the app's user-agent marker
 * (app/(dashboard)/layout.tsx), and handed down here — not worked out in the
 * browser, which would flash a price before hiding it.
 *
 * In a browser — the business host included — everything shows as before.
 */
import * as React from 'react';
import Link from 'next/link';

const NoBuying = React.createContext(false);

export function NoBuyingProvider({ value, children }: { value: boolean; children: React.ReactNode }) {
  return <NoBuying.Provider value={value}>{children}</NoBuying.Provider>;
}

/** True inside the business app: show no prices, no buy buttons, no "upgrade". */
export function useNoBuying(): boolean {
  return React.useContext(NoBuying);
}

/**
 * A link to choose or change the plan (/upgrade). Gone in the business app:
 * the feature's own explanation stays where it is (AGENTS §7), only the way
 * to buy it goes.
 */
export function UpgradeLink({
  href = '/upgrade',
  ...props
}: Omit<React.ComponentProps<typeof Link>, 'href'> & { href?: string }) {
  if (useNoBuying()) return null;
  return <Link href={href} {...props} />;
}
