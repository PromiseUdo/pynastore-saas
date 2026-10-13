'use client';

/*
 * lib/notifications/web-push-client.ts
 *
 * Notifications in a browser (ROADMAP 18.3): whether this one can have them,
 * asking, and telling the server. Used by the admin's and console's
 * "Alerts on this device", the bell's offer, and the storefront's prompts.
 *
 * What a browser can do:
 *   unsupported    no Push API (an old browser), or inside a store's own
 *                  app, which has phone notifications instead
 *   needs-install  an iPhone or iPad in Safari: push only works once the
 *                  site is added to the Home Screen and opened from there
 *   off            the platform hasn't set its keys (NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY)
 *   ready          it can ask
 *
 * The permission prompt only ever comes from a click (asking on page load is
 * how a browser learns to block a site), and only after our own explanation.
 */
import { isNativePlatform } from '@/lib/platform';

export type WebPushSupport = 'unsupported' | 'needs-install' | 'off' | 'ready';
export type WebPushState = 'on' | 'available' | 'blocked';

const PUBLIC_KEY = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ?? '';

function isAppleMobile(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function webPushSupport(): WebPushSupport {
  if (typeof window === 'undefined' || isNativePlatform()) return 'unsupported';
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isAppleMobile() && !isInstalled()) return 'needs-install';
  if (!capable) return 'unsupported';
  return PUBLIC_KEY ? 'ready' : 'off';
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/** This browser's subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (webPushSupport() !== 'ready') return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

/** On (subscribed here and allowed), available to turn on, or blocked in the browser's settings. */
export async function webPushState(): Promise<WebPushState> {
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission === 'granted' && (await currentSubscription())) return 'on';
  return 'available';
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64url}${'='.repeat((4 - (base64url.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function send(route: string, method: 'POST' | 'DELETE', body: Record<string, unknown>): Promise<boolean> {
  const response = await fetch(route, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return response.ok;
}

/**
 * Ask (call from a click), subscribe, and tell the server through `route`.
 * `extra` goes with it — a guest's order token, say.
 */
export async function turnOnWebPush(route: string, extra: Record<string, unknown> = {}): Promise<'on' | 'blocked' | 'failed'> {
  if (webPushSupport() !== 'ready') return 'failed';
  try {
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'failed';
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const subscription =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY) }));
    return (await send(route, 'POST', { subscription: subscription.toJSON(), ...extra })) ? 'on' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Stop on this browser: the server forgets it, and the browser drops it. */
export async function turnOffWebPush(route: string): Promise<boolean> {
  const subscription = await currentSubscription().catch(() => null);
  if (!subscription) return true;
  const told = await send(route, 'DELETE', { endpoint: subscription.endpoint }).catch(() => false);
  await subscription.unsubscribe().catch(() => false);
  return told;
}

/** Forget another of this person's browsers, from their list. */
export function removeWebPushDevice(route: string, id: string): Promise<boolean> {
  return send(route, 'DELETE', { id }).catch(() => false);
}

/** "Not now", remembered on this browser so the offer doesn't come back every visit. */
export function offerDismissed(key: string): boolean {
  try {
    return localStorage.getItem(`mansaas:push-offer:${key}`) === '1';
  } catch {
    return false;
  }
}

export function dismissOffer(key: string): void {
  try {
    localStorage.setItem(`mansaas:push-offer:${key}`, '1');
  } catch {
    // Not remembered; it just offers again next time.
  }
}
