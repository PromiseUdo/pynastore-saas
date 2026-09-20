'use client';

/*
 * Sending the shopper to Squad's payment page — on the web, and in the app.
 *
 * WEB: an ordinary full-page navigation. Squad sends the browser back through
 * /api/payments/squad/callback to the order's confirmation page.
 *
 * APP: the app is a WebView pinned to one origin (MOBILE.md), so navigating
 * it to Squad would throw the shopper out into the phone's browser and never
 * bring them back. Instead Squad opens in an in-app browser
 * (@capacitor/browser — SFSafariViewController / Chrome Custom Tabs, which
 * also handle bank 3-D Secure pages properly) on top of the app. When Squad
 * returns, the callback hands off to the app by deep link; when the shopper
 * closes the sheet themselves, we treat that the same way. Either way the app
 * then shows the confirmation page, which re-checks the payment with Squad —
 * so it never matters which of the two happened, or whether the payment went
 * through.
 */
import { isNativePlatform } from '@/lib/platform';

/** Must match the URL scheme registered in ios/…/Info.plist and AndroidManifest.xml. */
export const APP_URL_SCHEME = process.env.NEXT_PUBLIC_MOBILE_APP_SCHEME || 'com.mansaas.app';
export const PAYMENT_RETURN_HOST = 'payment-return';

export function isNativeApp(): boolean {
  return isNativePlatform();
}

export async function openPaymentPage(input: {
  paymentUrl: string;
  /** where the app should land once the shopper is back (native only) */
  confirmationPath: string;
  /** web: replace the current history entry instead of adding one */
  replace?: boolean;
}): Promise<void> {
  if (!isNativePlatform()) {
    if (input.replace) window.location.replace(input.paymentUrl);
    else window.location.assign(input.paymentUrl);
    return;
  }

  const [{ Browser }, { App }] = await Promise.all([import('@capacitor/browser'), import('@capacitor/app')]);

  const handles: { remove: () => Promise<void> }[] = [];
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    for (const handle of handles) void handle.remove();
    // Not supported on Android (the deep link already brought the app forward).
    void Browser.close().catch(() => {});
    window.location.replace(input.confirmationPath);
  };

  handles.push(await Browser.addListener('browserFinished', finish));
  handles.push(
    await App.addListener('appUrlOpen', ({ url }) => {
      if (url.startsWith(`${APP_URL_SCHEME}://${PAYMENT_RETURN_HOST}`)) finish();
    }),
  );

  await Browser.open({ url: input.paymentUrl, presentationStyle: 'fullscreen' });
}
