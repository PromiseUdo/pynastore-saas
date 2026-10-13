'use client';

/*
 * "Notifications on this device" — on the shopper's account page. One
 * switch for everything that's theirs: their orders and the store's chat
 * replies.
 *
 *   browser  on the shop's website: Web Push (ROADMAP 18.3)
 *   app      inside the store's own app: this phone, linked to their
 *            account (18.4). Already allowed → linked quietly on each visit,
 *            unless they turned it off here (remembered on the phone).
 *
 * The server picks the channel (the app can be reached, or the platform's
 * browser keys are set); a browser or phone that can't simply shows nothing.
 */
import * as React from 'react';
import { Bell, BellOff, Loader2, Share, SquarePlus } from 'lucide-react';
import { turnOffWebPush, turnOnWebPush, webPushState, webPushSupport } from '@/lib/notifications/web-push-client';
import { pushPermission, registerForPush } from '@/lib/mobile/push-client';
import { STOREFRONT_WEB_PUSH_ROUTE, type PushChannel } from '@/lib/storefront/push-optin';
import { setPhoneNotificationsAction } from '@/features/shop-account/notification-actions';

type State = 'checking' | 'hidden' | 'needs-install' | 'blocked' | 'off' | 'on';

const offKey = (store: string) => `mansaas:sf:${store}:phone-notifications-off`;
function turnedOffHere(store: string): boolean {
  try {
    return localStorage.getItem(offKey(store)) === '1';
  } catch {
    return false;
  }
}
function rememberOff(store: string, off: boolean): void {
  try {
    if (off) localStorage.setItem(offKey(store), '1');
    else localStorage.removeItem(offKey(store));
  } catch {
    // Not remembered; at worst the phone is linked again next visit.
  }
}

async function linkPhone(on: boolean): Promise<boolean> {
  const token = await registerForPush().catch(() => null);
  if (!token) return false;
  return setPhoneNotificationsAction(token, on).catch(() => false);
}

export function DeviceNotifications({ storeName, storeSlug, channel }: { storeName: string; storeSlug: string; channel: PushChannel }) {
  const [state, setState] = React.useState<State>('checking');
  const [working, setWorking] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const check = React.useCallback(async () => {
    if (channel === 'browser') {
      const support = webPushSupport();
      if (support === 'needs-install') return setState('needs-install');
      if (support !== 'ready') return setState('hidden');
      const now = await webPushState();
      return setState(now === 'on' ? 'on' : now === 'blocked' ? 'blocked' : 'off');
    }
    const permission = await pushPermission().catch(() => 'unavailable' as const);
    if (permission === 'unavailable') return setState('hidden');
    if (permission === 'denied') return setState('blocked');
    if (permission === 'granted' && !turnedOffHere(storeSlug)) {
      // Allowed before: keep this phone linked to whoever is signed in now.
      return setState((await linkPhone(true)) ? 'on' : 'off');
    }
    setState('off');
  }, [channel, storeSlug]);

  React.useEffect(() => {
    void check();
  }, [check]);

  async function toggle() {
    setWorking(true);
    setFailed(false);
    let ok: boolean;
    if (channel === 'browser') {
      ok = state === 'on' ? await turnOffWebPush(STOREFRONT_WEB_PUSH_ROUTE) : (await turnOnWebPush(STOREFRONT_WEB_PUSH_ROUTE)) !== 'failed';
    } else {
      const on = state !== 'on';
      ok = await linkPhone(on);
      if (ok) rememberOff(storeSlug, !on);
    }
    setWorking(false);
    setFailed(!ok);
    await check();
  }

  if (state === 'checking' || state === 'hidden') return null;

  return (
    <div className="mb-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        {state === 'blocked' ? (
          <BellOff aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        ) : (
          <Bell aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{channel === 'app' ? 'Notifications on this phone' : 'Notifications on this device'}</p>
          {state === 'needs-install' ? (
            <div className="mt-1 text-sm text-muted-foreground">
              <p>On iPhone and iPad, add {storeName} to your Home Screen first:</p>
              <p className="mt-2 flex flex-wrap items-center gap-1">
                Tap <Share aria-label="Share" className="size-4 text-foreground" />, then
                <SquarePlus aria-hidden className="size-4 text-foreground" /> “Add to Home Screen”, and open it from there.
              </p>
            </div>
          ) : state === 'blocked' ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {channel === 'app'
                ? 'Notifications are off for this app. You can turn them on in your phone’s Settings.'
                : 'Blocked for this site. You can allow notifications in your browser’s site settings.'}
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                {state === 'on'
                  ? 'On. We’ll tell you when an order moves along or the store replies to you.'
                  : 'Get notified about your orders and the store’s replies, even with the shop closed.'}
              </p>
              {failed && <p className="mt-1 text-sm text-destructive">That didn’t work. Please try again.</p>}
              <button
                type="button"
                onClick={() => void toggle()}
                disabled={working}
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
