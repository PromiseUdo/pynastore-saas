/*
 * components/social/platform-icon.tsx
 *
 * One small mark per social platform, used by every Social Commerce screen.
 *
 * Drawn here rather than imported: lucide-react removed its brand icons, and
 * a shop owner scanning a list needs to tell Facebook from Instagram at a
 * glance — a generic globe would make the list harder to read, not simpler.
 * Each mark is a plain glyph in the current text colour, so it works in both
 * themes without a hard-coded colour (AGENTS.md §1).
 *
 * Adding a platform means adding a case here; nothing else on a page changes.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';
import type { SocialPlatform } from '@/lib/social/types';

type Props = {
  platform: SocialPlatform;
  className?: string;
};

/** Decorative: the platform is always named in text beside it. */
const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

export function PlatformIcon({ platform, className }: Props) {
  const classes = cn('size-4', className);

  switch (platform) {
    case 'FACEBOOK_PAGE':
      // The "f" in a rounded square.
      return (
        <svg {...svgProps} className={classes}>
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <path d="M15 8h-1.5A2.5 2.5 0 0 0 11 10.5V21" />
          <path d="M8.5 13h5" />
        </svg>
      );

    case 'INSTAGRAM_BUSINESS':
      // Rounded square, lens, flash dot.
      return (
        <svg {...svgProps} className={classes}>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="3.75" />
          <circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );

    case 'TIKTOK':
      // A note with the hooked stem.
      return (
        <svg {...svgProps} className={classes}>
          <path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5" />
          <path d="M14 4a5 5 0 0 0 5 5" />
        </svg>
      );
  }
}
