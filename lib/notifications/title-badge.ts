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
 *
 * Never while printing: the title is a saved PDF's file name and is printed
 * on the page, and "(2) AurafumeNG receipt …" isn't the merchant's document.
 */
import * as React from 'react';

const counts = new Map<string, number>();
let observer: MutationObserver | null = null;
let printing = false;

const PREFIX = /^\(\d+\+?\)\s/;

function apply() {
  const count = printing ? 0 : Math.max(0, ...counts.values());
  const base = document.title.replace(PREFIX, '');
  const wanted = count > 0 ? `(${count > 99 ? '99+' : count}) ${base}` : base;
  if (document.title !== wanted) document.title = wanted;
}

function onBeforePrint() {
  printing = true;
  apply();
}
function onAfterPrint() {
  printing = false;
  apply();
}

/** Report this source's count while the component is mounted. */
export function useTitleCount(source: 'notifications' | 'messages', count: number): void {
  React.useEffect(() => {
    counts.set(source, count);
    apply();
    if (!observer) {
      observer = new MutationObserver(apply);
      observer.observe(document.head, { childList: true, subtree: true, characterData: true });
      window.addEventListener('beforeprint', onBeforePrint);
      window.addEventListener('afterprint', onAfterPrint);
    }
  }, [source, count]);

  React.useEffect(
    () => () => {
      counts.delete(source);
      if (counts.size === 0) {
        observer?.disconnect();
        observer = null;
        window.removeEventListener('beforeprint', onBeforePrint);
        window.removeEventListener('afterprint', onAfterPrint);
        document.title = document.title.replace(PREFIX, '');
      } else {
        apply();
      }
    },
    [source],
  );
}
