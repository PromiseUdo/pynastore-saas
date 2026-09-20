'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

const KEY = 'mansaas:sf:cookie-consent';

export function CookieConsent({ privacyHref = null }: { privacyHref?: string | null }) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setVisible(true);
    } catch {
      /* ignore */
    }
  }, []);

  const dismiss = (choice: 'all' | 'essential') => {
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="safe-bottom fixed inset-x-3 bottom-3 z-40 mx-auto max-w-2xl rounded-xl border bg-card p-4 shadow-lg lg:inset-x-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* The link appears only when the merchant has published a privacy
          * page — pointing at a 404 from a consent notice is worse than not
          * offering one. */}
        <p className="text-sm text-muted-foreground">
          We use cookies to run the store, remember your bag and understand what’s working.
          {privacyHref && (
            <>
              {' '}
              <Link href={privacyHref} className="font-medium text-foreground underline underline-offset-2">
                Privacy policy
              </Link>
            </>
          )}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => dismiss('essential')}>
            Essential only
          </Button>
          <Button size="sm" onClick={() => dismiss('all')}>
            Accept all
          </Button>
        </div>
      </div>
    </div>
  );
}
