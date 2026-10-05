'use client';

/*
 * "Share" — a product (or any page) to a friend.
 *
 * In the phone app it opens the phone's own share sheet (@capacitor/share,
 * ROADMAP 16.4): WhatsApp, Messages, Instagram, whatever the shopper has.
 * In a browser that has a share sheet (most phones) it uses that; anywhere
 * else it copies the link and says so.
 *
 * The link is always the store's public web address, never the app's own
 * origin, so it opens for whoever receives it — app or no app.
 */
import { Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { isNativePlatform } from '@/lib/platform';

export async function shareLink(input: { title: string; url: string }): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  try {
    if (isNativePlatform()) {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title: input.title, url: input.url, dialogTitle: 'Share' });
      return 'shared';
    }
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: input.title, url: input.url });
      return 'shared';
    }
    await navigator.clipboard.writeText(input.url);
    return 'copied';
  } catch (error) {
    // Closing the share sheet is not an error.
    const name = (error as { name?: string })?.name;
    const message = String((error as { message?: string })?.message ?? '');
    if (name === 'AbortError' || /cancel/i.test(message)) return 'cancelled';
    return 'failed';
  }
}

export function ShareButton({ title, url, className }: { title: string; url: string; className?: string }) {
  const onClick = async () => {
    const result = await shareLink({ title, url });
    if (result === 'copied') toast.success('Link copied');
    if (result === 'failed') toast.error('Couldn’t share just now. Please try again.');
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-[var(--sf-radius-button,999px)] border px-4 text-sm font-semibold transition-colors hover:border-brand hover:text-brand',
        className,
      )}
    >
      <Share2 aria-hidden className="size-4" />
      Share
    </button>
  );
}
