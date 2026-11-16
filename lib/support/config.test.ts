/* The website chat's settings (ROADMAP 23): only ever a Freshchat address reaches the CSP and a script tag. */
import { afterEach, describe, expect, it } from 'vitest';
import { getSupportChatConfig } from './config';

const saved = { host: process.env.FRESHCHAT_HOST, token: process.env.FRESHCHAT_TOKEN, uuid: process.env.FRESHCHAT_WIDGET_UUID };
afterEach(() => {
  for (const [k, v] of [['FRESHCHAT_HOST', saved.host], ['FRESHCHAT_TOKEN', saved.token], ['FRESHCHAT_WIDGET_UUID', saved.uuid]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const set = (host?: string, token?: string) => {
  if (host === undefined) delete process.env.FRESHCHAT_HOST;
  else process.env.FRESHCHAT_HOST = host;
  if (token === undefined) delete process.env.FRESHCHAT_TOKEN;
  else process.env.FRESHCHAT_TOKEN = token;
  delete process.env.FRESHCHAT_WIDGET_UUID;
};

describe('getSupportChatConfig', () => {
  it('is off until both values are set', () => {
    set(undefined, 'tok');
    expect(getSupportChatConfig()).toBeNull();
    set('https://acme-1.freshchat.com', undefined);
    expect(getSupportChatConfig()).toBeNull();
  });

  it('takes a Freshchat account host, tidied to its origin', () => {
    set('https://acme-1.freshchat.com/', 'tok');
    expect(getSupportChatConfig()).toEqual({ host: 'https://acme-1.freshchat.com', token: 'tok', widgetUuid: null });
  });

  it('refuses anything that isn’t an https Freshchat address', () => {
    for (const host of ['http://acme-1.freshchat.com', 'https://evil.com', 'https://freshchat.com.evil.com', 'https://a.b.freshchat.com', 'not a url']) {
      set(host, 'tok');
      expect(getSupportChatConfig()).toBeNull();
    }
  });
});
