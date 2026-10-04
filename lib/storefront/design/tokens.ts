/*
 * lib/storefront/design/tokens.ts
 *
 * A design → what the storefront root carries: four `data-sf-*` attributes
 * (look, corners, fonts, cards) that storefront.css styles, and the
 * merchant's brand colour as CSS custom properties. Pure.
 *
 * The colour goes in as `--merchant-brand*`, which the look's palette reads
 * with its own value as the fallback, so "no colour" needs no special case.
 * Text on it, and its hover shade, are worked out here rather than left to
 * the merchant. Dark mode gets the nearest lighter shade that stands out on
 * the dark background — usually the colour lifted a little.
 *
 * Every value is from a fixed list or a checked hex — this is the only path
 * from merchant settings into a `style` attribute.
 */
import { darkModeShade, hoverOf, isHex, textOn } from './colour';
import { LOOKS, type CardKey, type CornerKey, type FontKey, type LookKey } from './looks';
import type { StorefrontDesignConfig } from './schema';

export interface ResolvedDesign {
  look: LookKey;
  corners: CornerKey;
  fonts: FontKey;
  cards: CardKey;
  darkByDefault: boolean;
  attributes: {
    'data-sf-look': LookKey;
    'data-sf-corners': CornerKey;
    'data-sf-fonts': FontKey;
    'data-sf-cards': CardKey;
  };
  /** CSS custom properties for the root's `style`; empty without a colour */
  style: Record<string, string>;
}

export function resolveDesign(design: StorefrontDesignConfig): ResolvedDesign {
  const look = LOOKS[design.look];
  const corners = design.corners ?? look.defaults.corners;
  const fonts = design.fonts ?? look.defaults.fonts;
  const cards = design.cards ?? look.defaults.cards;

  const style: Record<string, string> = {};
  /* Checked again on the way out: it reaches a `style` attribute. A colour
   * saved before the contrast rule existed (Classic's old accent) is still
   * shown — the shop looked like that yesterday — but gets readable text. */
  if (isHex(design.brandColour)) {
    const colour = design.brandColour.toLowerCase();
    style['--merchant-brand'] = colour;
    style['--merchant-brand-hover'] = hoverOf(colour);
    style['--merchant-brand-fg'] = textOn(colour);
    const dark = darkModeShade(colour, look.darkBackground);
    style['--merchant-brand-dark'] = dark;
    style['--merchant-brand-dark-hover'] = hoverOf(dark);
    style['--merchant-brand-dark-fg'] = textOn(dark);
  }

  return {
    look: design.look,
    corners,
    fonts,
    cards,
    darkByDefault: design.darkByDefault,
    attributes: {
      'data-sf-look': design.look,
      'data-sf-corners': corners,
      'data-sf-fonts': fonts,
      'data-sf-cards': cards,
    },
    style,
  };
}
