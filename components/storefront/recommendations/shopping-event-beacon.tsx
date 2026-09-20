'use client';

/*
 * Records a page-level shopping event from a Server Component page.
 *
 * /search and /c/* are server-rendered with no client island that knows the
 * query or category, so they drop one of these in. Renders nothing; fires
 * once per distinct event (a re-render with the same query is not a second
 * search).
 */
import * as React from 'react';
import { trackShoppingEvent, type ShoppingEvent } from '@/lib/storefront/shopping-events';

export function ShoppingEventBeacon({ event }: { event: ShoppingEvent }) {
  const key = JSON.stringify(event);

  // Keyed on the serialised event, not the object: a server page passes a
  // fresh literal on every render.
  React.useEffect(() => {
    trackShoppingEvent(event);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return null;
}
