'use client';

/*
 * "Get updates on this order" — on the order's page, inside a store's own
 * app (ROADMAP 16.4) or, on the shop's website, in the browser (18.3).
 *
 * Asked here, about this order, rather than when the app opens: a shopper who
 * has just paid knows exactly what they'd be notified about, and both stores'
 * reviewers expect the question in context. Already allowed → this order is
 * added quietly. Refused → nothing is shown; we don't ask twice.
 *
 * Rendered only when the server has checked it can be reached: the app
 * (lib/mobile/push/watch.ts, pushReadyFor), or the platform's browser keys
 * are set. A browser that can't (an iPhone that hasn't installed the shop)
 * shows nothing.
 */
import * as React from 'react';
import { Bell, Loader2 } from 'lucide-react';
import { optIn, optInPermission, type PushChannel } from '@/lib/storefront/push-optin';
import { watchOrderUpdatesAction } from '@/features/shop-orders/actions';

type State = 'checking' | 'offer' | 'working' | 'on' | 'blocked' | 'failed' | 'hidden';

export function OrderUpdatesPrompt({ confirmationToken, channel = 'app' }: { confirmationToken: string; channel?: PushChannel }) {
  const [state, setState] = React.useState<State>('checking');

  const enable = React.useCallback(async () => {
    setState('working');
    const result = await optIn(
      channel,
      async (deviceToken) => (await watchOrderUpdatesAction(confirmationToken, deviceToken)).ok,
      { order: confirmationToken },
    );
    setState(result);
  }, [channel, confirmationToken]);

  React.useEffect(() => {
    let cancelled = false;
    void optInPermission(channel)
      .then((permission) => {
        if (cancelled) return;
        if (permission === 'granted') void enable();
        else setState(permission === 'prompt' ? 'offer' : 'hidden');
      });
    return () => {
      cancelled = true;
    };
  }, [channel, enable]);

  if (state === 'checking' || state === 'hidden') return null;

  if (state === 'on') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Bell aria-hidden className="size-4" />
        You&apos;ll get a notification when this order&apos;s status changes.
      </p>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <Bell aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Get updates on this order</p>
          {state === 'blocked' ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {channel === 'app'
                ? 'Notifications are off for this app. You can turn them on in your phone’s Settings.'
                : 'Notifications are blocked for this site. You can allow them in your browser’s site settings.'}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {state === 'failed'
                ? 'We couldn’t turn on notifications just now. Please try again.'
                : 'We’ll send a notification when it’s paid, on its way or delivered.'}
            </p>
          )}
          {state !== 'blocked' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void enable()}
                disabled={state === 'working'}
                className="inline-flex h-10 items-center gap-2 rounded-[var(--sf-radius-button,999px)] bg-brand px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover disabled:opacity-60"
              >
                {state === 'working' && <Loader2 aria-hidden className="size-4 animate-spin" />}
                Turn on notifications
              </button>
              <button
                type="button"
                onClick={() => setState('hidden')}
                className="inline-flex h-10 items-center rounded-[var(--sf-radius-button,999px)] px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Not now
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
