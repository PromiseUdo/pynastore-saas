'use client';

/*
 * One scroll listener, shared by everything that reacts to "the shopper has
 * scrolled a long way down".
 *
 * The back-to-top arrow and the floating assistant button live in the same
 * bottom-right corner and have to agree about that moment: the arrow appears
 * exactly as the assistant slides up out of its way. Two independent
 * listeners with two pieces of state can disagree for a frame and make the
 * pair jitter, so they subscribe to this instead.
 */
import * as React from 'react';

/** How far down the page the back-to-top arrow appears. */
export const BACK_TO_TOP_AT = 800;

let scrolled = false;
const listeners = new Set<() => void>();
let ticking = false;

function measure() {
  ticking = false;
  const next = window.scrollY > BACK_TO_TOP_AT;
  if (next === scrolled) return;
  scrolled = next;
  for (const l of listeners) l();
}

/* Reading scrollY per event is a layout read on the scroll path; a rAF keeps
 * it to one per frame. */
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(measure);
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener('scroll', onScroll, { passive: true });
    measure();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('scroll', onScroll);
  };
}

/** True once the page is scrolled past {@link BACK_TO_TOP_AT}. False on the server. */
export function usePageScrolled() {
  return React.useSyncExternalStore(
    subscribe,
    () => scrolled,
    () => false,
  );
}
