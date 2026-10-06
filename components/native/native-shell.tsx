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
 *   - a tapped order notification opens that order (store apps with push)
 */
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isNativePlatform, getPlatform } from '@/lib/platform';
import { userAgentHasPush } from '@/lib/mobile/app-config';

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

      const applyStatusBar = (dark: boolean) => {
        // Style.Light = light text (for dark backgrounds), Style.Dark = dark text.
        void StatusBar.setStyle({ style: dark ? Style.Light : Style.Dark });
        if (platform === 'android') {
          void StatusBar.setBackgroundColor({ color: dark ? '#0b0b0c' : '#ffffff' });
        }
      };

      /* The icons must contrast with what is BEHIND them: the shop's own
       * light or dark theme (which the shopper can switch, and which can
       * differ from the phone's setting) — the phone's setting only where
       * there is no shop on screen (the store picker). Android 15+ draws the
       * page under the status bar, so this is what keeps the clock and
       * signal readable (ROADMAP 16.5). */
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const isDark = () => {
        const shop = document.querySelector<HTMLElement>('[data-storefront]');
        return shop ? shop.dataset.sfTheme === 'dark' : mq.matches;
      };
      let last: boolean | null = null;
      const update = () => {
        const dark = isDark();
        if (dark === last) return;
        last = dark;
        applyStatusBar(dark);
      };
      update();
      mq.addEventListener('change', update);
      // The theme switch, and moving between pages with and without a shop.
      const observer = new MutationObserver(update);
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-sf-theme'] });
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
        // At the store picker / storefront home, back = leave the app.
        const atRoot = pathname === '/' || /^\/s\/[^/]+\/?$/.test(pathname);
        if (canGoBack && !atRoot) {
          router.back();
        } else {
          void App.exitApp();
        }
      });
    })();

    return () => handle?.remove();
  }, [pathname, router]);

  // Tapping an order notification opens that order (ROADMAP 16.4). Only in a
  // build with push; the plugin holds a tap that launched the app until this
  // listener is added.
  useEffect(() => {
    if (!isNativePlatform() || !userAgentHasPush(navigator.userAgent)) return;
    let handle: { remove: () => Promise<void> } | undefined;

    (async () => {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      handle = await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
        const path = (notification.data as { path?: unknown } | undefined)?.path;
        // Only a page of a store on this origin — never a URL from outside.
        if (typeof path === 'string' && /^\/s\/[a-z0-9-]+\/[^/]/.test(path)) router.push(path);
      });
    })();

    return () => void handle?.remove();
  }, [router]);

  return null;
}
