'use client';

/*
 * A strip above the header saying a sale is on.
 *
 * Every word is the merchant's. This component chooses no copy, only how to
 * show it.
 *
 * Dismissal is remembered per campaign, so a shopper who closes it is not
 * asked again for that sale — but a NEW campaign gets a fresh hearing.
 * Browser storage can be unavailable (private windows, blocked site data), so
 * every read and write is wrapped and the bar simply shows.
 *
 * HOW THE SCROLL WORKS, since the obvious version is wrong: the track is
 * sized to its CONTENT (`w-max`), not to the bar, and holds two identical
 * groups. Animating it by -50% therefore moves it by exactly one group, so
 * the second arrives precisely where the first began and the loop has no
 * seam. Sizing the track to the bar — the first attempt — made -50% half the
 * BAR's width instead, which is why the message set off from the middle,
 * ran out of the left-hand side and reappeared in the middle again.
 *
 * Each group is at least a screen wide (`min-w-[100vw]`) with its repeats
 * spread across it, so a short notice fills the bar evenly instead of
 * leaving a hole, and a long one simply flows past.
 *
 * Scrolling is opt-in and stops for anyone who has asked their system for
 * less motion: a marquee that can't be paused is a genuine accessibility
 * problem, not a style. Only the first repeat is readable by a screen
 * reader — the rest exist to fill the screen, and hearing the same sentence
 * six times would be its own bug.
 */
import * as React from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { isAnnouncementPreview, type Announcement } from '@/lib/marketing/announcement';

const KEY = 'sf-campaign-bar-dismissed';

function dismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function CampaignBar({ announcement }: { announcement: Announcement }) {
  /* Starts hidden and appears after mount: the server doesn't know what this
   * shopper has dismissed, and rendering it then removing it would flash the
   * bar at someone who closed it yesterday. */
  const [show, setShow] = React.useState(false);

  /* A merchant previewing their own bar sees it whether or not they have
   * closed it before — otherwise setting one up means clearing site data. */
  const [preview, setPreview] = React.useState(false);

  React.useEffect(() => {
    const previewing = isAnnouncementPreview(window.location.search);
    setPreview(previewing);
    setShow(previewing || !dismissed().includes(announcement.campaignId));
  }, [announcement.campaignId]);

  function close() {
    setShow(false);
    /* A preview leaves no trace: closing it must not dismiss the real bar
     * for the merchant's own customers-eye view later. */
    if (preview) return;
    try {
      const next = [...new Set([...dismissed(), announcement.campaignId])].slice(-20);
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* No storage — it comes back next time, which is better than not
       * closing at all. */
    }
  }

  if (!show) return null;

  const style = {
    backgroundColor: announcement.background ?? undefined,
    color: announcement.foreground ?? undefined,
  };

  /*
   * One pass of the notice: the words, and the link if there is one.
   *
   * EVERY pass is a real link. Only making the first one clickable — which
   * is what this did first — meant five of the six copies on screen looked
   * exactly like a link, didn't take a click, and didn't even change the
   * cursor. Whichever copy is under someone's mouse is the one they will
   * click, and it has to work.
   *
   * The repeats are kept out of the keyboard's way instead: `tabIndex={-1}`
   * so they are not tab stops, inside wrappers marked `aria-hidden` so the
   * notice is announced once. Untabbable content inside aria-hidden is fine;
   * it is FOCUSABLE content that is the fault.
   */
  const message = (interactive: boolean) => (
    <>
      <span>{announcement.text}</span>
      {announcement.cta && (
        <Link
          href={announcement.cta.href}
          tabIndex={interactive ? undefined : -1}
          className="ml-3 cursor-pointer underline underline-offset-2 hover:no-underline"
        >
          {announcement.cta.label}
        </Link>
      )}
    </>
  );

  /* Three per group is enough to look deliberate on a phone and on a wide
   * screen, given the group is spread across at least the viewport. */
  const REPEATS = 3;

  const group = (groupIndex: number) => (
    <div
      key={groupIndex}
      aria-hidden={groupIndex > 0}
      className="flex min-w-[100vw] shrink-0 items-center justify-around gap-12 px-6"
    >
      {Array.from({ length: REPEATS }, (_, i) => {
        // The very first pass is the message; every other one is scenery.
        const real = groupIndex === 0 && i === 0;
        return (
          <span key={i} aria-hidden={!real} className="flex shrink-0 items-center">
            {message(real)}
          </span>
        );
      })}
    </div>
  );

  return (
    <div
      role="region"
      aria-label="Store announcement"
      style={style}
      className={
        announcement.background
          ? 'relative overflow-hidden text-sm'
          : 'relative overflow-hidden bg-brand text-sm text-primary-foreground'
      }
    >
      {announcement.scroll ? (
        <div className="sf-marquee flex w-max whitespace-nowrap py-2">
          {/* Two identical groups: the track moves by exactly one of them. */}
          {group(0)}
          {group(1)}
        </div>
      ) : (
        <p className="sf-container flex items-center justify-center gap-2 py-2 pr-8 text-center">{message(true)}</p>
      )}

      <button
        type="button"
        onClick={close}
        aria-label="Close announcement"
        /* `bg-inherit` takes the bar's own colour, so scrolling text
          * disappears behind the button cleanly instead of running under it. */
        className="absolute right-0 top-0 flex h-full w-10 items-center justify-center bg-inherit transition-opacity hover:opacity-70"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
