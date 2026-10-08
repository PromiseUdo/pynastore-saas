// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatFeed } from './use-chat-feed';
import { POLL_FAST_MS, POLL_IDLE_AFTER_MS, POLL_SLOW_MS } from './rules';

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Let the poll's promise settle, then move the clock. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useChatFeed', () => {
  it('asks at once, then every few seconds', async () => {
    const poll = vi.fn().mockResolvedValue(false);
    renderHook(() => useChatFeed({ enabled: true, poll }));
    await advance(0);
    expect(poll).toHaveBeenCalledTimes(1);

    await advance(POLL_FAST_MS);
    expect(poll).toHaveBeenCalledTimes(2);
    await advance(POLL_FAST_MS);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('slows down after a quiet minute, and speeds up when something arrives', async () => {
    let next = false;
    const poll = vi.fn(async () => next);
    renderHook(() => useChatFeed({ enabled: true, poll }));
    await advance(POLL_IDLE_AFTER_MS + POLL_FAST_MS);
    const before = poll.mock.calls.length;

    // The poll at 60s found a quiet minute, so the next one is 10s later (70s).
    await advance(POLL_FAST_MS); // 66s
    expect(poll.mock.calls.length).toBe(before); // on the slow interval now
    next = true;
    await advance(POLL_SLOW_MS - 2 * POLL_FAST_MS); // 70s: something new arrives
    expect(poll.mock.calls.length).toBe(before + 1);
    next = false;
    await advance(POLL_FAST_MS); // 73s
    expect(poll.mock.calls.length).toBe(before + 2); // fast again
  });

  it('does nothing while disabled, and stops when disabled', async () => {
    const poll = vi.fn().mockResolvedValue(false);
    const { rerender, result } = renderHook(({ enabled }) => useChatFeed({ enabled, poll }), { initialProps: { enabled: false } });
    await advance(POLL_SLOW_MS * 3);
    expect(poll).not.toHaveBeenCalled();
    expect(result.current.status).toBe('paused');

    rerender({ enabled: true });
    await advance(0);
    expect(poll).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    await advance(POLL_SLOW_MS * 3);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('pauses while the tab is hidden and asks at once when it comes back', async () => {
    const poll = vi.fn().mockResolvedValue(false);
    renderHook(() => useChatFeed({ enabled: true, poll }));
    await advance(0);
    visibility = 'hidden';
    await advance(POLL_FAST_MS); // the scheduled poll finds the tab hidden and stops
    const calls = poll.mock.calls.length;
    await advance(POLL_SLOW_MS * 5);
    expect(poll.mock.calls.length).toBe(calls);

    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance(0);
    expect(poll.mock.calls.length).toBe(calls + 1);
  });

  it('reports reconnecting while polls fail, backs off, and recovers', async () => {
    let failing = true;
    const poll = vi.fn(async () => {
      if (failing) throw new Error('offline');
      return false;
    });
    const { result } = renderHook(() => useChatFeed({ enabled: true, poll }));
    await advance(0);
    expect(result.current.status).toBe('reconnecting');

    await advance(POLL_FAST_MS);
    expect(poll).toHaveBeenCalledTimes(1); // backed off past the fast interval
    await advance(POLL_FAST_MS);
    expect(poll).toHaveBeenCalledTimes(2);

    failing = false;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await advance(0);
    expect(result.current.status).toBe('live');
  });

  it('pollNow asks immediately, and never runs two polls at once', async () => {
    let release: (v: boolean) => void = () => {};
    let inFlight = 0;
    let maxInFlight = 0;
    const poll = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          release = (v) => {
            inFlight -= 1;
            resolve(v);
          };
        }),
    );
    const { result } = renderHook(() => useChatFeed({ enabled: true, poll }));
    await advance(0);
    expect(poll).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.pollNow();
      result.current.pollNow();
    });
    expect(poll).toHaveBeenCalledTimes(1); // queued behind the one in flight
    await act(async () => release(false));
    await advance(0);
    expect(poll).toHaveBeenCalledTimes(2); // the queued kick, once
    expect(maxInFlight).toBe(1);
    await act(async () => release(false));
  });
});
