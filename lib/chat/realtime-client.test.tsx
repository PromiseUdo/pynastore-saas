// @vitest-environment jsdom
/*
 * The browser end of real-time chat, against a stand-in for the Ably SDK:
 * when it says it's live, what an event does, and that every way of missing
 * events ends in a catch-up fetch rather than trust in Ably's replay.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (change: { current: string; previous?: string; resumed?: boolean }) => void;

class FakeChannel {
  stateListeners: Listener[] = [];
  updateListeners: Listener[] = [];
  handler: ((message: { data: unknown }) => void) | null = null;
  on(a: string | Listener, b?: Listener) {
    if (typeof a === 'function') this.stateListeners.push(a);
    else if (a === 'update' && b) this.updateListeners.push(b);
  }
  async subscribe(_name: string, handler: (message: { data: unknown }) => void) {
    this.handler = handler;
  }
  emit(current: string, resumed = false) {
    this.stateListeners.forEach((l) => l({ current, resumed }));
  }
}

class FakeRealtime {
  static instances: FakeRealtime[] = [];
  channel = new FakeChannel();
  channelName = '';
  closed = false;
  connectionListeners: Listener[] = [];
  connection = { on: (l: Listener) => void this.connectionListeners.push(l) };
  channels = {
    get: (name: string) => {
      this.channelName = name;
      return this.channel;
    },
  };
  constructor(public options: { authCallback: (params: unknown, cb: (err: unknown, token: unknown) => void) => void }) {
    FakeRealtime.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  connectionIs(current: string) {
    this.connectionListeners.forEach((l) => l({ current }));
  }
}

vi.mock('ably', () => ({ Realtime: FakeRealtime }));

const { useRealtimeChannel } = await import('./realtime-client');

const ok = (channel = 'chat:o:c') =>
  new Response(JSON.stringify({ tokenRequest: { keyName: 'k', mac: 'm' }, channel }), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeRealtime.instances = [];
  fetchMock = vi.fn(async () => ok());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(enabled = true) {
  const onEvent = vi.fn();
  const onCatchUp = vi.fn();
  const hook = renderHook(
    ({ on }) => useRealtimeChannel({ enabled: on, tokenUrl: '/token', tokenBody: { org: 'acme' }, onEvent, onCatchUp }),
    { initialProps: { on: enabled } },
  );
  return { ...hook, onEvent, onCatchUp };
}

async function connected() {
  await waitFor(() => expect(FakeRealtime.instances).toHaveLength(1));
  const realtime = FakeRealtime.instances[0];
  await waitFor(() => expect(realtime.channel.handler).not.toBeNull());
  return realtime;
}

describe('useRealtimeChannel', () => {
  it('does nothing until there is something to listen to', async () => {
    const { result } = setup(false);
    expect(result.current).toBe('off');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gets a token from our route, listens to the channel it names, and goes live once attached', async () => {
    const { result } = setup();
    const realtime = await connected();
    expect(fetchMock).toHaveBeenCalledWith('/token', expect.objectContaining({ method: 'POST', body: JSON.stringify({ org: 'acme' }) }));
    expect(realtime.channelName).toBe('chat:o:c');
    expect(result.current).toBe('connecting');
    act(() => realtime.channel.emit('attached'));
    expect(result.current).toBe('live');
  });

  it('hands over the first token, then renews through our route', async () => {
    setup();
    const realtime = await connected();
    const first = await new Promise((resolve) => realtime.options.authCallback({}, (_e, token) => resolve(token)));
    expect(first).toEqual({ keyName: 'k', mac: 'm' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => realtime.options.authCallback({}, (_e, token) => resolve(token)));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('passes on chat events and ignores anything else', async () => {
    const { onEvent } = setup();
    const realtime = await connected();
    act(() => realtime.channel.handler!({ data: { type: 'message', conversationId: 'c', seq: 4, sender: 'STAFF' } }));
    act(() => realtime.channel.handler!({ data: { anything: 'else' } }));
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'message', conversationId: 'c', seq: 4, sender: 'STAFF' });
  });

  it('falls back when the connection drops, and catches up from the database when it returns', async () => {
    const { result, onCatchUp } = setup();
    const realtime = await connected();
    act(() => {
      realtime.connectionIs('connected');
      realtime.channel.emit('attached');
    });
    expect(result.current).toBe('live');
    expect(onCatchUp).not.toHaveBeenCalled();

    act(() => realtime.connectionIs('disconnected'));
    expect(result.current).toBe('down');

    act(() => {
      realtime.connectionIs('connected');
      realtime.channel.emit('attached', true);
    });
    expect(onCatchUp).toHaveBeenCalledTimes(1);
    expect(result.current).toBe('live');
  });

  it('catches up when the channel comes back without continuity, rather than trusting the replay', async () => {
    const { onCatchUp } = setup();
    const realtime = await connected();
    act(() => realtime.channel.emit('attached'));
    act(() => realtime.channel.emit('suspended'));
    act(() => realtime.channel.emit('attached', false));
    expect(onCatchUp).toHaveBeenCalledTimes(1);
    act(() => realtime.channel.updateListeners.forEach((l) => l({ current: 'attached', resumed: false })));
    expect(onCatchUp).toHaveBeenCalledTimes(2);
  });

  it('stays off when Ably isn’t set up or there’s no conversation, and goes down on other refusals', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    const a = setup();
    await waitFor(() => expect(a.result.current).toBe('off'));
    a.unmount();

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    const b = setup();
    await waitFor(() => expect(b.result.current).toBe('off'));
    b.unmount();

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const c = setup();
    await waitFor(() => expect(c.result.current).toBe('down'));
    expect(FakeRealtime.instances).toHaveLength(0);
  });

  it('closes the connection when the chat goes away', async () => {
    const { unmount } = setup();
    const realtime = await connected();
    unmount();
    expect(realtime.closed).toBe(true);
  });
});
