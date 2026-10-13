'use client';

/*
 * Signing out of the admin, wherever the button is (ROADMAP 19.1, 19.4): back
 * to the sign-in page on this host — and, in the business app, this phone
 * stops getting that person's notifications first. A phone that still
 * belonged to them would keep telling whoever holds it about their shops.
 */
import { signOut } from 'next-auth/react';
import { phoneAlertsAvailable, turnOffPhoneAlerts } from '@/lib/business-app/phone-alerts';
import { marketingUrlHere } from '@/lib/tenant/urls';

export async function signOutHere(path = '/login'): Promise<void> {
  if (phoneAlertsAvailable()) {
    // Never let a slow network hold the person on the page: a few seconds, then sign out anyway.
    await Promise.race([turnOffPhoneAlerts().catch(() => false), new Promise((resolve) => setTimeout(resolve, 4000))]);
  }
  await signOut({ callbackUrl: marketingUrlHere(path) });
}
