'use client';

/*
 * "Get a notification when the store replies" — in the chat, inside a
 * store's own app (ROADMAP 17.4) or in the browser on the shop's website
 * (18.3). The chat's version of OrderUpdatesPrompt.
 *
 * Asked here, in the conversation, once there IS a conversation — a shopper
 * who has just written knows exactly what they'd be told about. Already
 * allowed → this conversation is added quietly. Refused at the phone → said
 * once, with where to change it. "Not now" is remembered on this device for
 * this store, so the chat doesn't ask every time it opens.
 *
 * Rendered only where the server said it can be reached (chat config
 * `push`: the app, from pushReadyFor, or the browser).
 */
import * as React from 'react';
import { Bell, Loader2 } from 'lucide-react';
import { optIn, optInPermission, type PushChannel } from '@/lib/storefront/push-optin';
import { notifyChatReplies } from '@/lib/storefront/chat-client';

type State = 'checking' | 'offer' | 'working' | 'on' | 'blocked' | 'failed' | 'hidden';

const dismissedKey = (org: string) => `mansaas:sf:${org}:chat-notify-dismissed`;

function wasDismissed(org: string): boolean {
  try {
    return localStorage.getItem(dismissedKey(org)) === '1';
  } catch {
    return false;
  }
}

export function ChatRepliesPrompt({ org, channel = 'app' }: { org: string; channel?: PushChannel }) {
  const [state, setState] = React.useState<State>('checking');

  /* `quietly`: already allowed, so this only links the phone again — no
   * card, not even for the moment it takes (it used to flash up and vanish). */
  const enable = React.useCallback(
    async (quietly = false) => {
      if (!quietly) setState('working');
      const result = await optIn(channel, (deviceToken) => notifyChatReplies(org, deviceToken));
      setState(quietly && result !== 'on' ? 'hidden' : result);
    },
    [channel, org],
  );

  React.useEffect(() => {
    let cancelled = false;
    void optInPermission(channel)
      .then((permission) => {
        if (cancelled) return;
        if (permission === 'granted') void enable(true);
        else setState(permission === 'prompt' && !wasDismissed(org) ? 'offer' : 'hidden');
      });
    return () => {
      cancelled = true;
    };
  }, [enable, org, channel]);

  if (state === 'checking' || state === 'hidden' || state === 'on') return null;

  return (
    <div className="mx-5 mt-3 flex items-start gap-3 rounded-2xl border bg-card p-3 text-sm">
      <Bell aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Get a notification when the store replies</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {state === 'blocked'
            ? channel === 'app'
              ? 'Notifications are off for this app. You can turn them on in your phone’s Settings.'
              : 'Notifications are blocked for this site. You can allow them in your browser’s site settings.'
            : state === 'failed'
              ? 'We couldn’t turn on notifications just now. Please try again.'
              : 'So you don’t have to keep the chat open.'}
        </p>
        {state !== 'blocked' && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void enable()}
              disabled={state === 'working'}
              className="inline-flex h-9 items-center gap-2 rounded-[var(--sf-radius-button,999px)] bg-brand px-4 text-xs font-semibold text-primary-foreground transition-colors hover:bg-brand-hover disabled:opacity-60"
            >
              {state === 'working' && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
              Turn on notifications
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.setItem(dismissedKey(org), '1');
                } catch {
                  // Not remembered; it just asks again next time.
                }
                setState('hidden');
              }}
              className="inline-flex h-9 items-center rounded-[var(--sf-radius-button,999px)] px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Not now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
