'use client';

/*
 * Mounted in the admin's frame (components/layout/dashboard-layout.tsx): in
 * the business app, with notifications allowed, make sure the server has this
 * phone's current token for the person signed in now (ROADMAP 19.4). Tokens
 * change after a reinstall, and the same phone may now be someone else's.
 * Renders nothing; does nothing in a browser.
 */
import * as React from 'react';
import { refreshPhoneAlerts } from '@/lib/business-app/phone-alerts';

export function PhoneAlertsSync() {
  React.useEffect(() => {
    void refreshPhoneAlerts().catch(() => {});
  }, []);
  return null;
}
