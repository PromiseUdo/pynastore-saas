'use client';

/*
 * "Notifications on this device" — on the shopper's account page (ROADMAP
 * 18.3). Turns browser notifications for their orders and the store's chat
 * replies on or off for this browser. Shown on the shop's website only (the
 * store's own app has its phone's notifications), and only when the server
 * has the platform's browser keys.
 */
import * as React from 'react';
import { Bell, BellOff, Loader2, Share, SquarePlus } from 'lucide-react';
import {
  turnOffWebPush,
  turnOnWebPush,
  webPushState,
  webPushSupport,
  type WebPushState,
  type WebPushSupport,
} from '@/lib/notifications/web-push-client';
import { STOREFRONT_WEB_PUSH_ROUTE } from '@/lib/storefront/push-optin';

export function DeviceNotifications({ storeName }: { storeName: string }) {
  const [support, setSupport] = React.useState<WebPushSupport | null>(null);
  const [state, setState] = React.useState<WebPushState | null>(null);
  const [working, setWorking] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const supported = webPushSupport();
    setSupport(supported);
    if (supported === 'ready') setState(await webPushState());
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggle() {
    setWorking(true);
    setFailed(false);
    const ok = state === 'on' ? await turnOffWebPush(STOREFRONT_WEB_PUSH_ROUTE) : (await turnOnWebPush(STOREFRONT_WEB_PUSH_ROUTE)) !== 'failed';
    setWorking(false);
    setFailed(!ok);
    await refresh();
  }

  // Inside the store's app, or a browser that can't: nothing to offer here.
  if (support === null || support === 'unsupported' || support === 'off') return null;

  return (
    <div className="mb-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        {state === 'blocked' ? (
          <BellOff aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        ) : (
          <Bell aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Notifications on this device</p>
          {support === 'needs-install' ? (
            <div className="mt-1 text-sm text-muted-foreground">
              <p>On iPhone and iPad, add {storeName} to your Home Screen first:</p>
              <p className="mt-2 flex flex-wrap items-center gap-1">
                Tap <Share aria-label="Share" className="size-4 text-foreground" />, then
                <SquarePlus aria-hidden className="size-4 text-foreground" /> “Add to Home Screen”, and open it from there.
              </p>
            </div>
          ) : state === 'blocked' ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Blocked for this site. You can allow notifications in your browser’s site settings.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                {state === 'on'
                  ? 'On. We’ll tell you when an order moves along or the store replies to you.'
                  : 'Hear when an order moves along or the store replies to you, even with this page closed.'}
              </p>
              {failed && <p className="mt-1 text-sm text-destructive">That didn’t work. Please try again.</p>}
              <button
                type="button"
                onClick={() => void toggle()}
                disabled={working || state === null}
                className={
                  state === 'on'
                    ? 'mt-3 inline-flex h-10 items-center gap-2 rounded-[var(--sf-radius-button,999px)] border border-border bg-card px-4 text-sm font-medium transition-colors hover:border-brand hover:text-brand disabled:opacity-60'
                    : 'mt-3 inline-flex h-10 items-center gap-2 rounded-[var(--sf-radius-button,999px)] bg-brand px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover disabled:opacity-60'
                }
              >
                {working && <Loader2 aria-hidden className="size-4 animate-spin" />}
                {state === 'on' ? 'Turn off' : 'Turn on notifications'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
