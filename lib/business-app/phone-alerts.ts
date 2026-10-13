'use client';

/*
 * lib/business-app/phone-alerts.ts
 *
 * "Alerts on this device" inside the business app (ROADMAP 19.4): the phone's
 * own notifications, not the browser's. The token goes straight to the
 * server (/notifications/native-push) and is never kept in the page.
 * Only offered in a build with push (its user agent says MansaasPush).
 */
import { inBusinessApp } from './client';
import { pushBuiltIn, pushPermission, registerForPush } from '@/lib/mobile/push-client';

const ROUTE = '/notifications/native-push';

/** In the business app, built with push. */
export function phoneAlertsAvailable(): boolean {
  return inBusinessApp() && pushBuiltIn();
}

export type PhoneAlertsState = 'on' | 'available' | 'blocked';

/**
 * Permission granted counts as on: the phone was registered when it was
 * granted, and registering again (below) only refreshes the same token.
 */
export async function phoneAlertsState(): Promise<PhoneAlertsState> {
  const permission = await pushPermission();
  if (permission === 'granted') return 'on';
  if (permission === 'denied') return 'blocked';
  return 'available';
}

async function send(method: 'POST' | 'DELETE', token: string): Promise<boolean> {
  const response = await fetch(ROUTE, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }).catch(() => null);
  return Boolean(response?.ok);
}

/** Ask the phone (only from a tap), then record it for the signed-in person. */
export async function turnOnPhoneAlerts(): Promise<'on' | 'blocked' | 'failed'> {
  const token = await registerForPush();
  if (!token) return (await pushPermission()) === 'denied' ? 'blocked' : 'failed';
  return (await send('POST', token)) ? 'on' : 'failed';
}

/** Stop this phone. The phone's own permission stays as the person set it. */
export async function turnOffPhoneAlerts(): Promise<boolean> {
  const token = await registerForPush();
  return token ? send('DELETE', token) : false;
}

/**
 * On every launch with permission already given, make sure the server has
 * this phone's current token — tokens change after a reinstall or restore,
 * and a phone signed in as someone new should become theirs.
 */
export async function refreshPhoneAlerts(): Promise<void> {
  if (!phoneAlertsAvailable() || (await pushPermission()) !== 'granted') return;
  const token = await registerForPush();
  if (token) await send('POST', token);
}
