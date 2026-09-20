'use client';

import * as React from 'react';
import { Toaster } from 'sonner';
import { PortalContainerProvider } from '@/components/ui/portal-container';
import {
  StorefrontProvider,
  type StorefrontOrg,
  type StorefrontShopper,
} from '@/lib/storefront/context';
import { BackToTop } from './back-to-top';
import { CookieConsent } from './cookie-consent';
import { QuickViewModal } from './product/quick-view-modal';
import { AssistantSheet } from './assistant/assistant-sheet';
import { useShoppingEventBridge } from '@/lib/storefront/use-shopping-event-bridge';

/** Mounted inside the provider so the stores are namespaced before it subscribes. */
function ShoppingEventBridge() {
  useShoppingEventBridge();
  return null;
}

export function StorefrontProviders({
  org,
  isMobileRuntime,
  shopper,
  privacyHref = null,
  children,
}: {
  org: StorefrontOrg;
  isMobileRuntime: boolean;
  shopper: StorefrontShopper | null;
  /** the merchant's published privacy page, if they have one */
  privacyHref?: string | null;
  children: React.ReactNode;
}) {
  /* Overlays portal into the themed wrapper, not <body>, or they render in
   * the admin palette and type (see components/ui/portal-container.tsx).
   * Resolved after mount — every overlay starts closed, so nothing opens
   * before this is set. */
  const [portalContainer, setPortalContainer] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    setPortalContainer(document.querySelector<HTMLElement>('[data-storefront]'));
  }, []);

  return (
    <PortalContainerProvider container={portalContainer}>
      <StorefrontProvider org={org} isMobileRuntime={isMobileRuntime} shopper={shopper}>
        <ShoppingEventBridge />
        {children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            classNames: {
              toast: 'rounded-lg border bg-card text-card-foreground text-sm shadow-lg',
            },
          }}
        />
        <QuickViewModal />
        {/* Mounted once, opened only from a contextual launcher — there is no
         * floating chat bubble over the storefront (§16). */}
        <AssistantSheet />
        <BackToTop />
        <CookieConsent privacyHref={privacyHref} />
      </StorefrontProvider>
    </PortalContainerProvider>
  );
}
