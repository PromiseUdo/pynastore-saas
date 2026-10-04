/*
 * lib/storefront/design/colour.ts
 *
 * Whether a merchant's brand colour can be read on their shop (ROADMAP
 * 15.1). Pure and client-safe, so the editor says exactly what the save
 * action will.
 *
 * The brand colour is used two ways across the storefront: as a FILL (buttons,
 * badges, bands) with text on top, and as TEXT and borders on the page
 * background (links, outlined buttons). So it must:
 *   - carry readable text: white or near-black on it at 4.5:1 or better
 *     (WCAG AA for body text) — whichever is better is used automatically;
 *   - stand out on the look's light background at 3:1 or better (WCAG's
 *     floor for large text and interface parts).
 * A colour that fails is refused with a darker shade of the same colour
 * offered instead, rather than a bare "no".
 *
 * Dark mode is not a refusal: most brand colours are too deep to stand out
 * on a dark page, so dark mode uses the nearest LIGHTER shade of the same
 * colour that does — still recognisably the merchant's colour.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX = /^#([0-9a-f]{6})$/i;

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const LIGHT_TEXT = '#ffffff';
export const DARK_TEXT = '#111111';

/** White or near-black, whichever reads better on this colour. */
export function textOn(hex: string): string {
  return contrast(LIGHT_TEXT, hex) >= contrast(DARK_TEXT, hex) ? LIGHT_TEXT : DARK_TEXT;
}

/** Mix towards black (amount > 0) or white (amount < 0). */
export function shade(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const target = amount > 0 ? 0 : 255;
  const t = Math.abs(amount);
  return rgbToHex({ r: r + (target - r) * t, g: g + (target - g) * t, b: b + (target - b) * t });
}

/** A hover shade: darker under white text, lighter under dark text. */
export function hoverOf(hex: string): string {
  return textOn(hex) === LIGHT_TEXT ? shade(hex, 0.12) : shade(hex, -0.12);
}

export const TEXT_ON_BRAND_MIN = 4.5;
export const BRAND_ON_BACKGROUND_MIN = 3;

export type BrandCheck =
  | { ok: true; text: string; hover: string; dark: string }
  | { ok: false; error: string; suggestion: string | null };

/**
 * The colour itself if it already stands out on the dark background,
 * otherwise the nearest lighter shade that does (and still carries readable
 * text). Lightening towards white always gets there.
 */
export function darkModeShade(hex: string, darkBackground: string): string {
  const reads = (c: string) =>
    contrast(c, darkBackground) >= BRAND_ON_BACKGROUND_MIN && contrast(textOn(c), c) >= TEXT_ON_BRAND_MIN;
  if (reads(hex)) return hex;
  for (let step = 1; step <= 20; step++) {
    const candidate = shade(hex, -step * 0.05);
    if (reads(candidate)) return candidate;
  }
  return '#ffffff';
}

function passes(hex: string, background: string): boolean {
  return contrast(textOn(hex), hex) >= TEXT_ON_BRAND_MIN && contrast(hex, background) >= BRAND_ON_BACKGROUND_MIN;
}

/**
 * Can this colour be the brand colour on a look whose light background is
 * `background`? `darkBackground` decides only whether dark mode uses it.
 */
export function checkBrandColour(hex: string, background: string, darkBackground: string): BrandCheck {
  if (!isHex(hex)) return { ok: false, error: 'Use a colour like #b42318', suggestion: null };
  const colour = hex.toLowerCase();

  if (!passes(colour, background)) {
    /* Darken in small steps until it works: the nearest shade of the same
     * colour that does, so the merchant keeps their colour's character. */
    let suggestion: string | null = null;
    for (let step = 1; step <= 20; step++) {
      const candidate = shade(colour, step * 0.05);
      if (passes(candidate, background)) {
        suggestion = candidate;
        break;
      }
    }
    const tooLight = contrast(colour, background) < BRAND_ON_BACKGROUND_MIN;
    return {
      ok: false,
      error: tooLight
        ? 'This colour is too light to stand out on your shop’s background.'
        : 'Text on this colour would be hard to read.',
      suggestion,
    };
  }

  return {
    ok: true,
    text: textOn(colour),
    hover: hoverOf(colour),
    dark: darkModeShade(colour, darkBackground),
  };
}
