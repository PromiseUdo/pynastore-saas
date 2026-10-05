'use client';

/*
 * "Get our app" — a slim strip at the top of the store's WEBSITE on a phone,
 * for a store whose own app is listed (ROADMAP 16.4).
 *
 *   Android        → Google Play
 *   iPhone, Safari → nothing: Safari shows Apple's own Smart App Banner from
 *                    the `apple-itunes-app` tag the layout's metadata sets
 *   iPhone, other  → the App Store
 *   computers      → nothing here; the footer's "Get our app" leads to /app,
 *                    which has a QR code
 *
 * Never inside the app. Closing it is remembered on this device for this
 * store; storage that throws (private mode) just means it shows again.
 * Rendered only after mount, because which phone this is is only known there.
 */
import * as React from 'react';
import { X } from 'lucide-react';
import { useStorefront } from '@/lib/storefront/context';
import type { StoreAppListing } from '@/lib/mobile/listing-rules';

type Target = { url: string; store: string } | null;

export function bannerTarget(userAgent: string, listing: StoreAppListing): Target {
  const isAndroid = /Android/i.test(userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  if (isAndroid && listing.googlePlayUrl) return { url: listing.googlePlayUrl, store: 'Google Play' };
  if (isIOS && listing.appStoreUrl) {
    const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent);
    return otherBrowser ? { url: listing.appStoreUrl, store: 'App Store' } : null;
  }
  return null;
}

export function GetAppBanner({ listing }: { listing: StoreAppListing }) {
  const { org, isMobileRuntime } = useStorefront();
  const key = `sf-app-banner-closed:${org.slug}`;
  const [target, setTarget] = React.useState<Target>(null);

  React.useEffect(() => {
    if (isMobileRuntime) return;
    let closed = false;
    try {
      closed = window.localStorage.getItem(key) === '1';
    } catch {
      /* private mode: show it */
    }
    if (!closed) setTarget(bannerTarget(navigator.userAgent, listing));
  }, [isMobileRuntime, key, listing]);

  if (!target) return null;

  const close = () => {
    setTarget(null);
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      /* nothing to remember it in */
    }
  };

  return (
    <div role="region" aria-label="Get our app" className="flex items-center gap-3 border-b bg-card px-4 py-2.5 text-sm">
      <button
        type="button"
        onClick={close}
        aria-label="Close"
        className="-ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
      >
        <X aria-hidden className="size-4" />
      </button>
      <p className="min-w-0 flex-1 leading-tight">
        <span className="block font-semibold">{listing.name} app</span>
        <span className="block text-xs text-muted-foreground">On {target.store}</span>
      </p>
      <a
        href={target.url}
        className="inline-flex h-9 shrink-0 items-center rounded-[var(--sf-radius-button,999px)] bg-brand px-4 text-xs font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
      >
        Get the app
      </a>
    </div>
  );
}
