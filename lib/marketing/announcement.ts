/*
 * lib/marketing/announcement.ts
 *
 * The rules for a campaign's announcement — pure, so the admin preview, the
 * storefront and the tests all agree about what a shopper will see.
 *
 * The important one: an announcement with no words is not an announcement.
 * Whatever the style says, empty text means nothing is shown — a merchant who
 * has written nothing has nothing to announce, and inventing a sentence for
 * them ("Sale now on!") is exactly what the storefront rules forbid.
 */

export type AnnouncementStyle = 'NONE' | 'BAR' | 'MODAL';

export interface AnnouncementInput {
  style: AnnouncementStyle;
  text: string | null;
  detail?: string | null;
  cta?: string | null;
  href?: string | null;
  image?: string | null;
  background?: string | null;
  foreground?: string | null;
  scroll?: boolean;
}

/** What a shopper actually sees, once the rules have been applied. */
export interface Announcement {
  campaignId: string;
  style: 'BAR' | 'MODAL';
  text: string;
  detail: string | null;
  cta: { label: string; href: string } | null;
  /** the merchant's own picture, for the pop-up */
  image: string | null;
  background: string | null;
  foreground: string | null;
  scroll: boolean;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A colour we are willing to put in a `style` attribute. */
export function isHexColour(value: string | null | undefined): value is string {
  return typeof value === 'string' && HEX.test(value.trim());
}

/**
 * A few ready-made looks, so a merchant who doesn't want to think about
 * colour doesn't have to. They are suggestions in the picker, not a closed
 * set — a shop's own brand colour is a legitimate answer.
 */
export const ANNOUNCEMENT_PRESETS = [
  { name: 'Ink', background: '#111827', foreground: '#ffffff' },
  { name: 'Sale red', background: '#b42318', foreground: '#ffffff' },
  { name: 'Forest', background: '#0f5132', foreground: '#ffffff' },
  { name: 'Sunshine', background: '#fde68a', foreground: '#1f2937' },
  { name: 'Sand', background: '#f5f0e6', foreground: '#1f2937' },
] as const;

/**
 * Only a link the storefront can safely send someone to.
 *
 * A path inside the store, or an https URL. `javascript:` and friends are
 * refused rather than sanitised — a merchant typing one has made a mistake,
 * and quietly half-fixing it would hide that.
 */
export function safeHref(href: string | null | undefined): string | null {
  const value = (href ?? '').trim();
  if (!value) return null;
  if (value.startsWith('/')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Turn what a merchant saved into what a shopper sees, or null for nothing
 * at all.
 */
export function resolveAnnouncement(campaignId: string, input: AnnouncementInput): Announcement | null {
  if (input.style === 'NONE') return null;

  const text = (input.text ?? '').trim();
  // No words, no announcement — whatever the style says.
  if (!text) return null;

  const label = (input.cta ?? '').trim();
  const href = safeHref(input.href);

  return {
    campaignId,
    style: input.style,
    text,
    // Only a modal has room for the rest of it, or for a picture.
    detail: input.style === 'MODAL' ? (input.detail ?? '').trim() || null : null,
    cta: label && href ? { label, href } : null,
    image: input.style === 'MODAL' ? (input.image ?? '').trim() || null : null,
    background: isHexColour(input.background) ? input.background.trim() : null,
    foreground: isHexColour(input.foreground) ? input.foreground.trim() : null,
    scroll: input.style === 'BAR' && Boolean(input.scroll),
  };
}

/*
 * A merchant checking their own announcement.
 *
 * Dismissal is remembered per campaign, which is right for a shopper and a
 * trap for the person who wrote it: close it once while setting it up and
 * the only way back is clearing site data. This flag, added to the URL by
 * the "See it on your store" link in the admin, tells the bar and the modal
 * to show regardless — and to leave no record, so the preview cannot itself
 * dismiss the real thing.
 *
 * It is harmless in a shopper's hands: the worst it can do is show an
 * announcement the merchant is already publishing.
 */
export const ANNOUNCEMENT_PREVIEW_PARAM = 'preview-announcement';

/** True when the current URL is asking for a preview. Client-side only. */
export function isAnnouncementPreview(search: string): boolean {
  try {
    return new URLSearchParams(search).has(ANNOUNCEMENT_PREVIEW_PARAM);
  } catch {
    return false;
  }
}
