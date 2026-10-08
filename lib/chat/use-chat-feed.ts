'use client';

/*
 * lib/chat/use-chat-feed.ts
 *
 * The client half of the realtime seam (ROADMAP 17; the server half is
 * ./realtime.ts). It decides WHEN to ask the server "anything new?" — the
 * caller decides what asking means and merges the answer (mergeMessages in
 * ./rules.ts), so the shopper's panel and the merchant's page share it.
 *
 * Polling, and only while someone is looking:
 *   - every 3s, easing to 10s after a minute with nothing new;
 *   - stopped while `enabled` is false (panel closed) or the tab is hidden;
 *   - asks at once when the tab comes back, the window regains focus, or the
 *     network returns — so a phone pulled from a pocket is up to date;
 *   - a failed poll backs off (6s, 12s, 24s, 30s…) and reports `reconnecting`
 *     until one succeeds; nothing already on screen is thrown away.
 *
 * When a hosted realtime service replaces polling, this hook subscribes
 * instead of setting timers, and keeps the same return value.
 */
import * as React from 'react';
import { nextPollDelay } from './rules';

export type ChatFeedStatus = 'live' | 'reconnecting' | 'paused';

export interface UseChatFeedOptions {
  /** false while nothing is on screen (the panel is closed) */
  enabled: boolean;
  /**
   * Ask once. Resolve true when something new arrived (which resets the
   * slow-down), false when nothing did; throw (or reject) when it failed.
   */
  poll: () => Promise<boolean>;
  /** override the fast/slow intervals — for a lighter background check */
  fastMs?: number;
  slowMs?: number;
}

export function useChatFeed({ enabled, poll, fastMs, slowMs }: UseChatFeedOptions): {
  status: ChatFeedStatus;
  /** ask now (after a send, say) and restart the timer from fast */
  pollNow: () => void;
} {
  const [status, setStatus] = React.useState<ChatFeedStatus>(enabled ? 'live' : 'paused');
  const pollRef = React.useRef(poll);
  const kickRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  React.useEffect(() => {
    if (!enabled) {
      setStatus('paused');
      kickRef.current = () => {};
      return;
    }

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let again = false;
    let failures = 0;
    let lastActivity = Date.now();

    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

    const schedule = () => {
      if (stopped || hidden()) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, nextPollDelay({ sinceActivityMs: Date.now() - lastActivity, failures, fastMs, slowMs }));
    };

    async function run() {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = null;
      if (hidden()) return;
      // One poll at a time; a kick during one runs straight after it.
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      try {
        const gotNew = await pollRef.current();
        if (stopped) return;
        if (gotNew) lastActivity = Date.now();
        failures = 0;
        setStatus('live');
      } catch {
        if (stopped) return;
        failures += 1;
        setStatus('reconnecting');
      } finally {
        inFlight = false;
      }
      if (again) {
        again = false;
        void run();
      } else {
        schedule();
      }
    }

    const kick = () => {
      lastActivity = Date.now();
      void run();
    };
    kickRef.current = kick;

    const onVisible = () => {
      if (!hidden()) kick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', kick);

    setStatus('live');
    void run();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', kick);
    };
  }, [enabled, fastMs, slowMs]);

  const pollNow = React.useCallback(() => kickRef.current(), []);
  return { status, pollNow };
}
