'use client';

/*
 * lib/notifications/chime.ts
 *
 * A short, soft two-note sound when something new arrives in the admin or
 * the console — most useful when the tab is in the background. Made with the
 * Web Audio API (no sound file to load), at a low volume.
 *
 * Browsers only let a page make sound after the person has interacted with
 * it, so the sound is "unlocked" on the first click or key press; before
 * that it stays silent rather than erroring. It can be turned off per
 * browser (Settings → Notifications), and plays at most once every few
 * seconds, so a burst is one chime.
 */

const KEY = 'mansaas:notification-sound';
const QUIET_MS = 3_000;

let context: AudioContext | null = null;
let lastPlayed = 0;
let listening = false;

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered; the default (on) applies.
  }
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  return context;
}

/** Call once on a page that may chime: the first click or key press makes sound possible. */
export function prepareChime(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const unlock = () => {
    void audio()?.resume().catch(() => {});
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** Two gentle notes, rising. Silent when turned off, too soon after the last, or not unlocked yet. */
export function playChime(): void {
  if (!soundEnabled() || Date.now() - lastPlayed < QUIET_MS) return;
  const ctx = audio();
  if (!ctx || ctx.state !== 'running') return;
  lastPlayed = Date.now();
  const start = ctx.currentTime;
  for (const [i, frequency] of [880, 1318.5].entries()) {
    const at = start + i * 0.12;
    const tone = ctx.createOscillator();
    const volume = ctx.createGain();
    tone.type = 'sine';
    tone.frequency.value = frequency;
    volume.gain.setValueAtTime(0.0001, at);
    volume.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    tone.connect(volume).connect(ctx.destination);
    tone.start(at);
    tone.stop(at + 0.4);
  }
}
