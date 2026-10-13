'use client';

/*
 * lib/realtime/client.ts
 *
 * The browser's end of the real-time hint channels (./ably.ts). One hook,
 * used by the storefront chat panel, the merchant's Messages page and the
 * notification bell (ROADMAP 18.2). Chat events are what it accepts unless a
 * caller says otherwise (`accept`).
 *
 * What it does — and doesn't:
 *   - asks OUR server for a listen-only token (the route decides the channel
 *     from who is asking); the API key never reaches the browser, and the
 *     token is renewed through the same route before it expires;
 *   - subscribes to that one channel and hands each event to `onEvent`,
 *     which only ever triggers the existing "fetch after #N" — so a repeated,
 *     late or out-of-order event can't put a message on screen twice
 *     (mergeMessages keeps one per seq);
 *   - calls `onCatchUp` whenever events may have been missed: a connection
 *     that comes back, or a channel that re-attaches without Ably's
 *     continuity (`resumed: false`) — so recovery never depends on Ably's
 *     two-minute replay window;
 *   - reports whether it's `live`, which callers use to slow their polling
 *     to a backup interval. Anything else — not configured, no token,
 *     disconnected, suspended, failed — and polling runs at its normal pace.
 *
 * The SDK is loaded only when a channel is actually listened to, so no
 * other page carries it.
 */
import * as React from 'react';

export type RealtimeState = 'off' | 'connecting' | 'live' | 'down';

/** What a channel carries (mirrors ChatEvent in lib/chat/ably.ts — server only). */
export type ChatEventView =
  | { type: 'message'; conversationId: string; seq: number; sender: 'CUSTOMER' | 'STAFF' }
  | { type: 'status'; conversationId: string };

interface TokenAnswer {
  tokenRequest: unknown;
  channel: string;
}

class TokenError extends Error {
  constructor(public status: number) {
    super(`realtime token ${status}`);
  }
}

async function fetchToken(url: string, body: Record<string, unknown>): Promise<TokenAnswer> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) throw new TokenError(response.status);
  return (await response.json()) as TokenAnswer;
}

function isChatEvent(value: unknown): value is ChatEventView {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (v.type === 'message' || v.type === 'status') && typeof v.conversationId === 'string';
}

export function useRealtimeChannel<E = ChatEventView>(options: {
  /** false while there's nothing to listen to (no conversation yet, chat closed, Ably off) */
  enabled: boolean;
  /** our token route */
  tokenUrl: string;
  tokenBody?: Record<string, unknown>;
  /** which messages are this channel's events (default: chat events) */
  accept?: (data: unknown) => data is E;
  onEvent: (event: E) => void;
  onCatchUp: () => void;
}): RealtimeState {
  const { enabled, tokenUrl } = options;
  const bodyKey = JSON.stringify(options.tokenBody ?? {});
  const [state, setState] = React.useState<RealtimeState>(enabled ? 'connecting' : 'off');

  const onEvent = React.useRef(options.onEvent);
  const onCatchUp = React.useRef(options.onCatchUp);
  const accept = React.useRef<(data: unknown) => boolean>(options.accept ?? isChatEvent);
  React.useEffect(() => {
    onEvent.current = options.onEvent;
    onCatchUp.current = options.onCatchUp;
    accept.current = options.accept ?? isChatEvent;
  });

  React.useEffect(() => {
    if (!enabled) {
      setState('off');
      return;
    }
    let cancelled = false;
    let close: (() => void) | null = null;
    const body = JSON.parse(bodyKey) as Record<string, unknown>;
    setState('connecting');

    void (async () => {
      let first: TokenAnswer;
      try {
        first = await fetchToken(tokenUrl, body);
      } catch (error) {
        // 404: nothing to listen to yet; 503: Ably isn't set up; anything else: try polling.
        if (!cancelled) setState(error instanceof TokenError && (error.status === 404 || error.status === 503) ? 'off' : 'down');
        return;
      }
      if (cancelled) return;

      const Ably = await import('ably');
      if (cancelled) return;

      let prefetched: unknown = first.tokenRequest;
      const realtime = new Ably.Realtime({
        authCallback: (_params, callback) => {
          if (prefetched) {
            const token = prefetched as Parameters<typeof callback>[1];
            prefetched = null;
            callback(null, token);
            return;
          }
          fetchToken(tokenUrl, body)
            .then((answer) => callback(null, answer.tokenRequest as Parameters<typeof callback>[1]))
            .catch((error: unknown) => callback(error instanceof Error ? error.message : 'token refused', null));
        },
        echoMessages: false,
        closeOnUnload: true,
      });
      close = () => realtime.close();

      let connectedBefore = false;
      realtime.connection.on((change) => {
        if (cancelled) return;
        if (change.current === 'connected') {
          // Back after a drop: whatever happened meanwhile is in the database.
          if (connectedBefore) onCatchUp.current();
          connectedBefore = true;
        } else if (['disconnected', 'suspended', 'failed', 'closed'].includes(change.current)) {
          setState('down');
        }
      });

      const channel = realtime.channels.get(first.channel);
      let attachedBefore = false;
      channel.on((change) => {
        if (cancelled) return;
        if (change.current === 'attached') {
          if (attachedBefore && !change.resumed) onCatchUp.current();
          attachedBefore = true;
          setState('live');
        } else if (change.current === 'suspended' || change.current === 'failed' || change.current === 'detached') {
          setState('down');
        }
      });
      // An `update` without continuity (Ably lost some messages for this channel): catch up.
      channel.on('update', (change) => {
        if (!cancelled && !change.resumed) onCatchUp.current();
      });

      try {
        await channel.subscribe('change', (message) => {
          if (!cancelled && accept.current(message.data)) onEvent.current(message.data as E);
        });
      } catch {
        if (!cancelled) setState('down');
      }
    })();

    return () => {
      cancelled = true;
      close?.();
    };
  }, [enabled, tokenUrl, bodyKey]);

  return state;
}

/** The backup polling interval while real-time is live — see each caller for why it's that long. */
export function backupInterval(state: RealtimeState, backupMs: number): { fastMs?: number; slowMs?: number } {
  return state === 'live' ? { fastMs: backupMs, slowMs: backupMs } : {};
}
