'use client';

/*
 * A campaign announcement that needs more than a line — "orders for sale
 * items ship from the 27th", say.
 *
 * Shown ONCE per shopper per campaign. A modal that returns on every page
 * view is the most reliable way to make someone leave, so the record of
 * having seen it is written the moment it opens, not when it is closed.
 *
 * It waits a beat before appearing: arriving over a page that is still
 * painting reads as an error, and someone who came to buy something specific
 * deserves to see where they landed first.
 *
 * Every word is the merchant's.
 */
import * as React from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { isAnnouncementPreview, type Announcement } from '@/lib/marketing/announcement';

const KEY = 'sf-campaign-modal-seen';

function seen(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function CampaignModal({ announcement }: { announcement: Announcement }) {
  const [open, setOpen] = React.useState(false);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    /* A merchant previewing their own modal sees it every time, and the
     * preview records nothing — otherwise checking it once would use up the
     * single showing they were testing. */
    const previewing = isAnnouncementPreview(window.location.search);
    if (!previewing && seen().includes(announcement.campaignId)) return;

    const timer = setTimeout(() => {
      setOpen(true);
      if (previewing) return;
      /* Written on opening, not on closing: a shopper who navigates away
       * without closing it has still had their one showing. */
      try {
        const next = [...new Set([...seen(), announcement.campaignId])].slice(-20);
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* No storage — they may see it again, which is the mild failure. */
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [announcement.campaignId]);

  React.useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  /*
   * With a picture the card is the picture: full-bleed across the top, the
   * words beneath it on the merchant's colours. Without one it is a quiet
   * card — a pop-up with two lines of text floating in the middle of a white
   * box looks like an error message, not a shop window.
   */
  const tinted = Boolean(announcement.background);

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close announcement"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px] animate-in fade-in-0"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-modal-title"
        className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-card shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-2"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className={
            announcement.image
              ? /* Over a photo the button needs its own backing, or it
                 * disappears into whatever the merchant uploaded. */
                'absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65'
              : 'absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full text-current opacity-60 transition-opacity hover:opacity-100'
          }
        >
          <X className="size-4" />
        </button>

        {announcement.image && (
          <div className="relative aspect-[4/3] w-full bg-tile">
            {/* The merchant's own artwork. next/image would need every
              * merchant's Cloudinary host in the config; this is one picture
              * they uploaded themselves. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={announcement.image}
              alt=""
              className="size-full object-cover"
              loading="eager"
              decoding="async"
            />
          </div>
        )}

        <div
          style={{
            backgroundColor: announcement.background ?? undefined,
            color: announcement.foreground ?? undefined,
          }}
          className="px-6 py-6 text-center"
        >
          <h2 id="campaign-modal-title" className="font-display text-2xl leading-tight">
            {announcement.text}
          </h2>

          {announcement.detail && (
            <p className="mx-auto mt-2.5 max-w-xs whitespace-pre-line text-sm leading-relaxed opacity-85">
              {announcement.detail}
            </p>
          )}

          {announcement.cta && (
            <Link
              href={announcement.cta.href}
              onClick={() => setOpen(false)}
              /* On a colour the merchant picked, the store's brand button can
               * disappear into it. Swapping their own two colours round is
               * legible on any tint they could have chosen, because they
               * already had to read one against the other. */
              style={
                tinted
                  ? {
                      backgroundColor: announcement.foreground ?? '#ffffff',
                      color: announcement.background ?? '#000000',
                    }
                  : undefined
              }
              className={
                tinted
                  ? 'mt-5 inline-flex h-11 w-full items-center justify-center rounded-full px-5 text-sm font-semibold transition-opacity hover:opacity-90'
                  : 'mt-5 inline-flex h-11 w-full items-center justify-center rounded-full bg-brand px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90'
              }
            >
              {announcement.cta.label}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
