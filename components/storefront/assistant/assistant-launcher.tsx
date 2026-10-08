'use client';

/*
 * The only way into the assistant.
 *
 * A small client island that carries its page's context (§10 — ids and a
 * query, never product rows) into the shared sheet. Everything around it on
 * a product page, a category page or an empty search stays server-rendered
 * (§42).
 *
 * Four looks, one behaviour: `chip` sits in a row of other shortcuts,
 * `button` is a standalone call to action, `link` is a quiet inline offer,
 * and `floating` is a helper pinned to the corner — for the homepage when a
 * merchant's own slides have taken the place of the discovery hero and its
 * "Ask the assistant" went with it.
 *
 * The floating one shares that corner with the back-to-top arrow, so it rests
 * at the bottom of the screen and slides up to make room the moment the arrow
 * appears (see `.sf-assistant-fab` in storefront.css). Sitting permanently
 * high enough to clear an arrow that is usually hidden just puts a button in
 * the middle of the shop on a phone.
 */
import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePageScrolled } from '@/lib/storefront/use-page-scrolled';
import { useStorefront } from '@/lib/storefront/context';
import { useChatConfig } from '@/components/storefront/chat/chat-config';
import {
  useAssistantStore,
  type AssistantSeed,
} from '@/lib/storefront/stores/assistant-store';

export function AssistantLauncher({
  seed,
  label,
  variant = 'chip',
  className,
}: {
  seed: AssistantSeed;
  label: string;
  variant?: 'chip' | 'button' | 'link' | 'floating';
  className?: string;
}) {
  const { org } = useStorefront();
  const openPanel = useAssistantStore((s) => s.openPanel);
  const scrolled = usePageScrolled();
  /* The corner holds one floating button. When the shop takes messages it
   * belongs to "Message us" (ROADMAP 17.3), and this one sits in the page
   * as a chip instead. */
  const chatOn = useChatConfig() !== null;
  if (variant === 'floating' && chatOn) {
    return (
      <div className="sf-container mt-4 flex justify-center">
        <AssistantLauncher seed={seed} label={label} variant="chip" className={className} />
      </div>
    );
  }

  const floating = variant === 'floating';

  return (
    <button
      type="button"
      onClick={() => openPanel(seed, org.slug)}
      data-lifted={floating && scrolled ? 'true' : undefined}
      className={cn(
        'inline-flex items-center gap-2 font-medium transition-colors',
        /* `sf-assistant-fab` owns the vertical position — above the phone's
         * tab bar, lifted clear of the back-to-top arrow (storefront.css). */
        floating &&
          'sf-assistant-fab fixed right-4 z-30 h-12 rounded-[var(--sf-radius-button,999px)] bg-brand px-5 text-sm font-semibold text-primary-foreground shadow-lg shadow-foreground/15 hover:bg-brand-hover lg:right-6',
        variant === 'chip' &&
          'h-11 whitespace-nowrap rounded-[var(--sf-radius-button,999px)] border bg-card px-4 text-sm hover:border-brand hover:text-brand',
        variant === 'button' &&
          'h-11 rounded-[var(--sf-radius-button,999px)] bg-brand px-5 text-sm font-semibold text-primary-foreground hover:bg-brand-hover',
        variant === 'link' && 'text-sm underline underline-offset-4 hover:text-brand',
        className,
      )}
    >
      <Sparkles
        aria-hidden
        className={cn('size-4', variant !== 'button' && 'text-teal')}
      />
      {label}
    </button>
  );
}
