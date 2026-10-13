'use client';

/*
 * lib/notifications/title-badge.ts
 *
 * "(3) Orders" in the browser tab while something is waiting — the one sign
 * a person on another tab can see. Two sources feed it: the notification
 * bell and the Messages watcher. The tab shows the larger of the two, not
 * the sum: a waiting chat message is usually on the bell too, and counting
 * it twice would be wrong.
 *
 * Next sets the title on every navigation, so this watches the head and
 * puts the prefix back.
 */
import * as React from 'react';

const counts = new Map<string, number>();
let observer: MutationObserver | null = null;

const PREFIX = /^\(\d+\+?\)\s/;

function apply() {
  const count = Math.max(0, ...counts.values());
  const base = document.title.replace(PREFIX, '');
  const wanted = count > 0 ? `(${count > 99 ? '99+' : count}) ${base}` : base;
  if (document.title !== wanted) document.title = wanted;
}

/** Report this source's count while the component is mounted. */
export function useTitleCount(source: 'notifications' | 'messages', count: number): void {
  React.useEffect(() => {
    counts.set(source, count);
    apply();
    if (!observer) {
      observer = new MutationObserver(apply);
      observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    }
  }, [source, count]);

  React.useEffect(
    () => () => {
      counts.delete(source);
      if (counts.size === 0) {
        observer?.disconnect();
        observer = null;
        document.title = document.title.replace(PREFIX, '');
      } else {
        apply();
      }
    },
    [source],
  );
}
