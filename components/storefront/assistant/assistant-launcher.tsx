'use client';

/*
 * The only way into the assistant.
 *
 * A small client island that carries its page's context (§10 — ids and a
 * query, never product rows) into the shared sheet. Everything around it on
 * a product page, a category page or an empty search stays server-rendered
 * (§42).
 *
 * Three looks, one behaviour: `chip` sits in a row of other shortcuts,
 * `button` is a standalone call to action, `link` is a quiet inline offer.
 */
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStorefront } from '@/lib/storefront/context';
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
  variant?: 'chip' | 'button' | 'link';
  className?: string;
}) {
  const { org } = useStorefront();
  const openPanel = useAssistantStore((s) => s.openPanel);

  return (
    <button
      type="button"
      onClick={() => openPanel(seed, org.slug)}
      className={cn(
        'inline-flex items-center gap-2 font-medium transition-colors',
        variant === 'chip' &&
          'h-11 whitespace-nowrap rounded-full border bg-card px-4 text-sm hover:border-brand hover:text-brand',
        variant === 'button' &&
          'h-11 rounded-full bg-brand px-5 text-sm font-semibold text-primary-foreground hover:bg-brand-hover',
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
