/*
 * The Pynastore logo, drawn from the brand pack's own artwork
 * (./logo-paths.ts, from brand-source/). Server-safe: no hooks, no client JS.
 *
 * Which piece goes where (the pack's README):
 *   - <PynastoreLogo>   the primary horizontal logo, symbol + wordmark.
 *                       Never smaller than 24px tall.
 *   - <PynastoreSymbol> the symbol alone, 24px and up; `small` is the
 *                       pack's optical small-size cut (wider halo) for
 *                       anything smaller — tab icons, the shop credit.
 *
 * Colourways: `colour` (green block and wordmark, for light backgrounds) and
 * `reverse` (white block and wordmark, for green or dark ones). Without a
 * tone it follows the page: reversed inside the admin's `.dark` or a shop's
 * dark theme (app/globals.css, `.pyna-logo`). The orb is saffron in every
 * colourway — the pack says never to recolour it.
 */
import { PLATFORM_MARK_COLORS, PLATFORM_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils';
import {
  BLOCK_PATH,
  HORIZONTAL_VIEWBOX,
  ORB_PATH,
  SMALL_BLOCK_PATH,
  SMALL_ORB_PATH,
  SYMBOL_VIEWBOX,
  WORDMARK_PATH,
  WORDMARK_TRANSFORM,
} from './logo-paths';

export type LogoTone = 'colour' | 'reverse';

const BLOCK = `var(--pyna-block, ${PLATFORM_MARK_COLORS.block})`;
const WORD = `var(--pyna-word, ${PLATFORM_MARK_COLORS.block})`;

/** Decorative unless given a title: next to the written name it says nothing new. */
function a11y(title: string | undefined) {
  return title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const, focusable: false };
}

export function PynastoreLogo({
  className,
  tone,
  title = PLATFORM_NAME,
}: {
  /** set the height (e.g. `h-7 w-auto`); the width follows */
  className?: string;
  tone?: LogoTone;
  /** the accessible name; pass '' when the name is written beside it */
  title?: string;
}) {
  return (
    <svg
      viewBox={HORIZONTAL_VIEWBOX}
      data-tone={tone}
      className={cn('pyna-logo h-7 w-auto shrink-0', className)}
      {...a11y(title)}
    >
      <path d={BLOCK_PATH} fill={BLOCK} />
      <path d={ORB_PATH} fill={PLATFORM_MARK_COLORS.orb} />
      <g transform={WORDMARK_TRANSFORM}>
        <path d={WORDMARK_PATH} fill={WORD} />
      </g>
    </svg>
  );
}

export function PynastoreSymbol({
  className,
  tone,
  small = false,
  title,
}: {
  className?: string;
  tone?: LogoTone;
  /** the optical small-size cut: use it below 24px */
  small?: boolean;
  title?: string;
}) {
  return (
    <svg viewBox={SYMBOL_VIEWBOX} data-tone={tone} className={cn('pyna-logo size-6 shrink-0', className)} {...a11y(title)}>
      <path d={small ? SMALL_BLOCK_PATH : BLOCK_PATH} fill={BLOCK} />
      <path d={small ? SMALL_ORB_PATH : ORB_PATH} fill={PLATFORM_MARK_COLORS.orb} />
    </svg>
  );
}
