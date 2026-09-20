'use client';

/*
 * Where overlay primitives (dialog, sheet, menus, tooltips) portal to.
 *
 * Radix portals to <body> by default. That is fine for the admin, whose
 * design tokens live on :root, but the storefront scopes its whole theme —
 * palette, display font, pill buttons, dark mode — to a `[data-storefront]`
 * wrapper. An overlay portalled to <body> escapes that wrapper and renders in
 * the admin look. A surface that scopes its theme provides its wrapper here;
 * with no provider, `undefined` keeps Radix's <body> default.
 */
import * as React from 'react';

const PortalContainerContext = React.createContext<HTMLElement | null>(null);

export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: React.ReactNode;
}) {
  return (
    <PortalContainerContext.Provider value={container}>{children}</PortalContainerContext.Provider>
  );
}

export function usePortalContainer(): HTMLElement | undefined {
  return React.useContext(PortalContainerContext) ?? undefined;
}
