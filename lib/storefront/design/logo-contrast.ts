/*
 * lib/storefront/design/logo-contrast.ts
 *
 * Will this logo disappear on the shop's dark mode? Checked in the browser
 * when a merchant uploads one (Settings → Business details), so they're told
 * BEFORE a shopper sees it, and can add a light version.
 *
 * The rule: a logo with its own background (mostly opaque — a JPG, a logo on
 * a white square) brings that background with it, so it's fine. A logo on a
 * transparent background whose drawn parts are mostly too dark to stand out
 * on the lightest of the dark backgrounds (every look's, lib/storefront/design/looks.ts)
 * needs a light version. The storefront still protects it either way: with
 * no light version, dark mode puts the logo on a light backing.
 */
import { luminance } from './colour';
import { LOOKS } from './looks';

/** Fewer transparent pixels than this: the logo has its own background. */
const TRANSPARENT_SHARE = 0.15;
/** A drawn pixel this close to the background is effectively invisible on it. */
const MIN_CONTRAST = 2.5;
/** More of the drawn logo hidden than this: warn. */
const HIDDEN_SHARE = 0.5;

/** The lightest dark-mode background of any look: where a dark logo has the least room. */
const LIGHTEST_DARK = Math.max(...Object.values(LOOKS).map((l) => luminance(l.darkBackground)));

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** `pixels` is RGBA, as a canvas gives it. */
export function logoHiddenOnDark(pixels: Uint8ClampedArray | number[]): boolean {
  const total = pixels.length / 4;
  if (!total) return false;
  let transparent = 0;
  let drawn = 0;
  let hidden = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < 32) {
      transparent += 1;
      continue;
    }
    if (a < 128) continue; // soft edges decide nothing
    drawn += 1;
    const l = 0.2126 * channel(pixels[i]) + 0.7152 * channel(pixels[i + 1]) + 0.0722 * channel(pixels[i + 2]);
    const [hi, lo] = l > LIGHTEST_DARK ? [l, LIGHTEST_DARK] : [LIGHTEST_DARK, l];
    if ((hi + 0.05) / (lo + 0.05) < MIN_CONTRAST) hidden += 1;
  }
  if (transparent / total < TRANSPARENT_SHARE || !drawn) return false;
  return hidden / drawn > HIDDEN_SHARE;
}

/**
 * Loads the uploaded logo and checks it. null when it can't be read (the
 * image host refused, an old browser) — then nothing is said.
 */
export async function checkLogoForDarkMode(url: string): Promise<boolean | null> {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    return logoHiddenOnDark(ctx.getImageData(0, 0, size, size).data);
  } catch {
    return null;
  }
}
