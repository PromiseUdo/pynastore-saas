'use client';

/*
 * components/native/native-shell.tsx
 *
 * One-time native runtime bootstrap. Mounted once in the root layout.
 * A no-op on the web — every native call is gated behind isNativePlatform()
 * and runs only in an effect, so this is safe to render everywhere.
 *
 * Responsibilities:
 *   - hide the splash screen after the first storefront paint
 *   - configure the status bar (style + colour, light/dark aware)
 *   - toggle a `.keyboard-open` class so layouts can react to the keyboard
 *   - Android hardware back button → history back, or exit at the root
 *   - stamp `<html data-native="ios|android">` for CSS hooks
 *   - a tapped notification opens its page (store apps with push)
 *   - a link to the store (an email, a message, a share) opens its page in
 *     the store's own app instead of the browser (Universal Links / App
 *     Links, ROADMAP 18.5)
 *   - in the business app, a link off the business host (or to a new tab)
 *     opens in the in-app browser sheet, on top of the app (ROADMAP 19.2)
 */
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isNativePlatform, getPlatform } from '@/lib/platform';
import { userAgentHasPush } from '@/lib/mobile/app-config';
import { routeIncomingLink } from '@/lib/mobile/app-links';
import { externalLinkTarget, inBusinessApp, isBusinessEntryPath, openExternal } from '@/lib/business-app/client';

/** Close the topmost open Radix dialog, sheet or menu, as Escape does. True when there was one. */
function closeOpenOverlay(): boolean {
  // Radix overlays say data-state="open"; the admin's phone menu is a plain modal dialog (components/layout/sidebar.tsx).
  const open = document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="dialog"][aria-modal="true"]',
  );
  if (!open) return false;
  (open as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return true;
}

let launchLinkHandled = false;

export function NativeShell() {
  const router = useRouter();
  const pathname = usePathname();

  // Hide the splash screen once the first route has painted.
  useEffect(() => {
    if (!isNativePlatform()) return;
    let cancelled = false;
    (async () => {
      const { SplashScreen } = await import('@capacitor/splash-screen');
      // Wait one frame so the storefront is actually on screen.
      requestAnimationFrame(() => {
        if (!cancelled) void SplashScreen.hide();
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Status bar + platform data attribute + keyboard listeners.
  useEffect(() => {
    if (!isNativePlatform()) return;

    const platform = getPlatform();
    document.documentElement.dataset.native = platform;

    const cleanups: Array<() => void> = [];

    (async () => {
      const [{ StatusBar, Style }, { Keyboard }] = await Promise.all([
        import('@capacitor/status-bar'),
        import('@capacitor/keyboard'),
      ]);

      /* Capacitor names its styles after the BACKGROUND they suit, not the
       * icons: Style.Dark = LIGHT icons for a dark background, Style.Light =
       * DARK icons for a light one (@capacitor/status-bar definitions). */
      const applyStatusBar = (darkBehind: boolean) => {
        void StatusBar.show();
        void StatusBar.setStyle({ style: darkBehind ? Style.Dark : Style.Light });
        if (platform === 'android') {
          // Colours the bar itself on Android 14 and older; ignored from 15,
          // where apps are drawn edge to edge.
          void StatusBar.setBackgroundColor({ color: darkBehind ? '#0b0b0c' : '#ffffff' });
        }
      };

      /*
       * The icons must contrast with what is BEHIND them (ROADMAP 16.5):
       *
       *  - The page draws under the bar (Android 15+ with an up-to-date
       *    WebView: Capacitor then sets --safe-area-inset-top) or the bar is
       *    coloured by us (Android 14 and older): behind it is the shop's own
       *    light or dark theme, which the shopper can switch — or the phone's
       *    setting where there is no shop on screen (the store picker).
       *  - Android 15+ with an older WebView instead leaves its own gap above
       *    the page, in the window's background — white — whatever the shop's
       *    theme. Dark icons, always.
       */
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const androidMajor = Number(navigator.userAgent.match(/Android (\d+)/)?.[1] ?? 0);
      const pageUnderBar = () =>
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top')) > 0;
      const darkBehind = () => {
        if (platform === 'android' && androidMajor >= 15 && !pageUnderBar()) return false;
        const shop = document.querySelector<HTMLElement>('[data-storefront]');
        if (shop) return shop.dataset.sfTheme === 'dark';
        // The admin (business app, ROADMAP 19.4) is dark only when its `.dark` class says so.
        if (inBusinessApp()) return document.documentElement.classList.contains('dark');
        return mq.matches;
      };
      let last: boolean | null = null;
      const update = () => {
        const dark = darkBehind();
        if (dark === last) return;
        last = dark;
        applyStatusBar(dark);
      };
      update();
      mq.addEventListener('change', update);
      // The theme switch, moving between pages with and without a shop, and
      // Capacitor setting the inset variables on <html> once the page loads.
      const observer = new MutationObserver(update);
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-sf-theme'] });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
      cleanups.push(() => mq.removeEventListener('change', update), () => observer.disconnect());

      const showHandle = await Keyboard.addListener('keyboardWillShow', () => {
        document.documentElement.classList.add('keyboard-open');
      });
      const hideHandle = await Keyboard.addListener('keyboardWillHide', () => {
        document.documentElement.classList.remove('keyboard-open');
      });
      cleanups.push(() => void showHandle.remove(), () => void hideHandle.remove());
    })();

    return () => {
      delete document.documentElement.dataset.native;
      cleanups.forEach((fn) => fn());
    };
  }, []);

  // Android hardware back button.
  useEffect(() => {
    if (!isNativePlatform() || getPlatform() !== 'android') return;
    let handle: { remove: () => void } | undefined;

    (async () => {
      const { App } = await import('@capacitor/app');
      handle = await App.addListener('backButton', ({ canGoBack }) => {
        // An open dialog, sheet or menu closes first, as Escape would (Radix listens for it).
        if (closeOpenOverlay()) return;
        // At the store picker / storefront home — or the business app's dashboard — back = leave the app.
        const atRoot = pathname === '/' || /^\/s\/[^/]+\/?$/.test(pathname) || (inBusinessApp() && pathname === '/dashboard');
        if (canGoBack && !atRoot) {
          router.back();
        } else {
          void App.exitApp();
        }
      });
    })();

    return () => handle?.remove();
  }, [pathname, router]);

  // Tapping a notification opens its page — an order, the account's
  // notifications, the chat, a product (ROADMAP 16.4, 18.4). Only in a build
  // with push; the plugin holds a tap that launched the app (a cold start)
  // until this listener is added, so it isn't lost.
  useEffect(() => {
    if (!isNativePlatform() || !userAgentHasPush(navigator.userAgent)) return;
    let handle: { remove: () => Promise<void> } | undefined;

    (async () => {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      handle = await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
        const path = (notification.data as { path?: unknown } | undefined)?.path;
        // Only a page on this origin — never a URL from outside. A store's app
        // opens /s/{slug}/…; the business app opens /o/{slug}/…, which switches
        // shop first, so it's a full load (ROADMAP 19.4).
        if (typeof path !== 'string') return;
        if (inBusinessApp()) {
          if (isBusinessEntryPath(path)) window.location.assign(path);
        } else if (/^\/s\/[a-z0-9-]+\/[^/]/.test(path)) router.push(path);
      });
    })();

    return () => void handle?.remove();
  }, [router]);

  // A link to the store, handed to this app by the phone (ROADMAP 18.5) —
  // while it runs (appUrlOpen) or as what launched it (getLaunchUrl). The
  // phone only does that for hosts the app claims and the store vouches for
  // (/.well-known/…). In a store's own app every bare path is its store, so
  // the link's path is the page. The custom-scheme returns from payment and
  // sign-in (lib/mobile/deep-link.ts) aren't https and are left to their flows.
  useEffect(() => {
    if (!isNativePlatform()) return;
    let handle: { remove: () => Promise<void> } | undefined;
    const open = (url: string | undefined) => {
      const route = url ? routeIncomingLink(url) : null;
      if (!route) return;
      if ('open' in route) router.push(route.open);
      // A page the app doesn't show: the browser, rather than nothing at all.
      else void import('@capacitor/browser').then(({ Browser }) => Browser.open({ url: route.browser }));
    };

    (async () => {
      const { App } = await import('@capacitor/app');
      // The launch link once per app run, however often this effect re-runs.
      if (!launchLinkHandled) {
        launchLinkHandled = true;
        open((await App.getLaunchUrl().catch(() => undefined))?.url);
      }
      handle = await App.addListener('appUrlOpen', ({ url }) => open(url));
    })();

    return () => void handle?.remove();
  }, [router]);

  // The business app stays on its one host (ROADMAP 19.2). "View my shop",
  // help pages and every other link that leaves it — or asks for a new tab,
  // which an app doesn't have — open in the sheet on top of the app, so the
  // merchant is one "Done" away from where they were. Mail and phone links
  // go to the phone's own apps as they always do.
  useEffect(() => {
    if (!inBusinessApp()) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      const link = anchor ? externalLinkTarget(anchor.href, anchor.target, window.location.href) : null;
      if (!link) return;
      event.preventDefault();
      if (link.open === 'sheet') void openExternal(link.url);
      else window.location.assign(link.url);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return null;
}
