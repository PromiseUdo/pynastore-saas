'use client';

/*
 * Collapses long copy behind "Read more" / "Show less", on every screen.
 *
 * How much shows:
 *   - beside the specifications (desktop, two columns): down to the bottom
 *     of the specifications box, so the two columns end together;
 *   - otherwise: a phone-sized preview (10rem), or a taller one (28rem) on a
 *     desktop with no specifications beside it.
 * Copy that is only a little longer than that is simply shown — a button that
 * reveals two more lines is more effort than the lines.
 *
 * The content is server-rendered and passed in as children, so the text is
 * always in the HTML — this only decides how much of it is visible, which
 * keeps it in the page for search engines. Until the page is measured the
 * same caps come from CSS, so the first paint is already collapsed.
 */
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const PHONE_CAP = 160; // 10rem
const DESKTOP_CAP = 448; // 28rem
const MIN_MATCHED_CAP = 192; // a short specs table shouldn't squeeze the copy to a few lines
const SLACK = 48; // within this of the cap, just show it all

export function ReadMore({
  children,
  className,
  matchId,
}: {
  children: React.ReactNode;
  className?: string;
  /** the element to end level with on wide screens (the specifications box) */
  matchId?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [measured, setMeasured] = React.useState<{ cap: number; overflows: boolean } | null>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const contentId = React.useId();

  React.useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)');
    const match = matchId ? document.getElementById(matchId) : null;

    const measure = () => {
      const el = box.current;
      const inner = content.current;
      if (!el || !inner) return;
      let cap = PHONE_CAP;
      if (wide.matches) {
        cap = match
          ? Math.max(match.getBoundingClientRect().bottom - el.getBoundingClientRect().top, MIN_MATCHED_CAP)
          : DESKTOP_CAP;
      }
      const overflows = inner.scrollHeight > cap + SLACK;
      setMeasured((prev) => (prev && prev.cap === cap && prev.overflows === overflows ? prev : { cap, overflows }));
    };

    measure();
    const observer = new ResizeObserver(measure);
    if (content.current) observer.observe(content.current);
    if (match) observer.observe(match);
    wide.addEventListener('change', measure);
    return () => {
      observer.disconnect();
      wide.removeEventListener('change', measure);
    };
  }, [matchId]);

  const collapsed = !expanded && (measured ? measured.overflows : true);

  const toggle = () => {
    if (expanded) {
      // Folding it back up from far below would leave the reader somewhere
      // further down the page than where they were reading: go back to it.
      const top = box.current?.getBoundingClientRect().top ?? 0;
      if (top < 0) box.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    setExpanded((value) => !value);
  };

  return (
    <div className={className}>
      <div
        ref={box}
        id={contentId}
        className={cn(
          'relative scroll-mt-28 overflow-hidden',
          // Before the first measurement, the same caps from CSS.
          !measured && !expanded && 'max-h-40 lg:max-h-[28rem]',
        )}
        style={collapsed && measured ? { maxHeight: measured.cap } : undefined}
      >
        <div ref={content}>{children}</div>
        {collapsed && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent"
          />
        )}
      </div>

      {(expanded || measured?.overflows) && (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={contentId}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-teal underline-offset-4 hover:underline"
        >
          {expanded ? 'Show less' : 'Read more'}
          <ChevronDown aria-hidden className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
        </button>
      )}
    </div>
  );
}
