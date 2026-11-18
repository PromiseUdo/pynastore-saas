/*
 * One small outline mark per social platform, for the storefront footer.
 *
 * Drawn here because lucide-react no longer ships brand icons. Each is a
 * plain glyph in the current text colour, so it takes on every look and both
 * themes. Decorative: the link around it carries the platform's name.
 */
import type { SocialPlatform } from '@/lib/storefront/social-links';
import { cn } from '@/lib/utils';

const svg = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

export function SocialGlyph({ platform, className }: { platform: SocialPlatform; className?: string }) {
  const c = cn('size-4', className);
  switch (platform) {
    case 'instagram':
      return (
        <svg {...svg} className={c}>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="3.75" />
          <circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'facebook':
      return (
        <svg {...svg} className={c}>
          <path d="M15 3h-2a4 4 0 0 0-4 4v14" />
          <path d="M6 11h8" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg {...svg} className={c}>
          <path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5" />
          <path d="M14 4a5 5 0 0 0 5 5" />
        </svg>
      );
    case 'x':
      return (
        <svg {...svg} className={c}>
          <path d="M4 4l16 16" />
          <path d="M20 4l-6.5 6.8M10.5 13.2L4 20" />
        </svg>
      );
    case 'youtube':
      return (
        <svg {...svg} className={c}>
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
          <path d="M10.5 9.5l4 2.5-4 2.5z" fill="currentColor" />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg {...svg} className={c}>
          <path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z" />
          <path d="M9.5 9.5c.3 2 2.5 4.6 5 5l1-1.3-1.8-.9-.8.8c-.9-.4-1.9-1.4-2.3-2.3l.8-.8-.9-1.8z" />
        </svg>
      );
    case 'linkedin':
      return (
        <svg {...svg} className={c}>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <path d="M8 10.5V17M8 7.5v.01M12 17v-3.5a2.5 2.5 0 0 1 5 0V17M12 10.5V17" />
        </svg>
      );
  }
}
