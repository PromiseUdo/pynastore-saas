'use client';

/*
 * A lapsed workspace opens only billing, choosing a plan and the orders
 * already placed (ROADMAP 12.1, lib/billing/access.ts) — every other page
 * shows the "Your plan has ended" screen instead.
 *
 * Decided HERE, from the current address, not in the dashboard layout: a
 * layout isn't re-rendered when the merchant follows a link inside it, so a
 * decision made there sticks to the page they arrived on. Clicking "Choose a
 * plan" from a closed page then changed the address but kept showing the
 * closed screen — the button seemed to do nothing.
 */
import * as React from 'react';
import { usePathname } from 'next/navigation';
import { isOpenWhileLapsed } from '@/lib/billing/access';

export function LapsedGate({
  lapsed,
  closedScreen,
  children,
}: {
  lapsed: boolean;
  /** what a closed page shows instead */
  closedScreen: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? '/';
  return lapsed && !isOpenWhileLapsed(pathname) ? closedScreen : children;
}
