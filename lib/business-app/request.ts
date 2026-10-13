/*
 * lib/business-app/request.ts
 *
 * Server side: is this request from the business app (ROADMAP 19)? From its
 * user-agent marker. A forged marker only HIDES things — buy buttons, prices
 * — so it can't be used to get anything.
 */
import { headers } from 'next/headers';
import { isBusinessAppUserAgent } from '@/lib/mobile/app-config';

export async function isBusinessAppRequest(): Promise<boolean> {
  try {
    return isBusinessAppUserAgent((await headers()).get('user-agent'));
  } catch {
    // Outside a request (a job, a script).
    return false;
  }
}

/** What a purchase action answers in the app, where nothing is sold (19.3). */
export const NOT_IN_THE_APP = 'This isn’t available in the app.';
