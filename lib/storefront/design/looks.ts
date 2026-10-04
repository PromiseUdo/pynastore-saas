/*
 * lib/storefront/design/looks.ts
 *
 * The five looks a merchant chooses between (ROADMAP 15.1), and the three
 * things Fine-tune may change on top of one. Pure and client-safe: the
 * editor shows these, the save action validates against them, and the
 * storefront turns them into `data-sf-*` attributes that storefront.css
 * styles. The look's palette, spacing and type scale live in storefront.css;
 * this file holds what TypeScript has to reason about — the names, the
 * defaults, and the background colours a brand colour is checked against.
 *
 * One look sets everything. There are no separate layout, typography,
 * button or image pickers on purpose: six independent choices is thousands
 * of combinations, most of them clashing.
 */

export const LOOK_KEYS = ['classic', 'minimal', 'editorial', 'bold', 'playful'] as const;
export type LookKey = (typeof LOOK_KEYS)[number];

export const CORNER_KEYS = ['square', 'soft', 'round'] as const;
export type CornerKey = (typeof CORNER_KEYS)[number];

export const FONT_KEYS = ['classic', 'modern', 'elegant', 'friendly'] as const;
export type FontKey = (typeof FONT_KEYS)[number];

export const CARD_KEYS = ['standard', 'minimal', 'framed'] as const;
export type CardKey = (typeof CARD_KEYS)[number];

export interface LookInfo {
  label: string;
  /** one line a merchant can choose by */
  description: string;
  defaults: { corners: CornerKey; fonts: FontKey; cards: CardKey };
  /**
   * The look's light background and default brand colour, as hex. Kept in
   * step with storefront.css by hand; used to check a merchant's colour
   * stands out on it, and to draw the look's sample in the editor.
   */
  background: string;
  foreground: string;
  brand: string;
  /** a second surface for the editor's sample: the product tile */
  tile: string;
  /** the look's dark-mode background — a merchant colour is lifted until it stands out on it */
  darkBackground: string;
}

export const LOOKS: Record<LookKey, LookInfo> = {
  classic: {
    label: 'Classic',
    description: 'Warm cream, a soft serif and rounded buttons. Your shop as it is today.',
    defaults: { corners: 'round', fonts: 'classic', cards: 'standard' },
    background: '#f6f2e2',
    foreground: '#001822',
    brand: '#001822',
    tile: '#faf7ee',
    darkBackground: '#0b1f27',
  },
  minimal: {
    label: 'Minimal',
    description: 'Crisp white, cool greys, light headings and lots of space. Lets the products do the talking.',
    defaults: { corners: 'soft', fonts: 'modern', cards: 'minimal' },
    background: '#ffffff',
    foreground: '#0a0a0a',
    brand: '#0a0a0a',
    tile: '#f5f5f7',
    darkBackground: '#0f0f10',
  },
  editorial: {
    label: 'Editorial',
    description: 'Warm paper, elegant headings, square edges and a deep oxblood accent, like a magazine.',
    defaults: { corners: 'square', fonts: 'elegant', cards: 'minimal' },
    background: '#f3ede2',
    foreground: '#231a14',
    brand: '#8a3324',
    tile: '#ebe3d4',
    darkBackground: '#17130f',
  },
  bold: {
    label: 'Bold',
    description: 'Strong type, high contrast and solid colour. Built for deals and big launches.',
    defaults: { corners: 'square', fonts: 'modern', cards: 'framed' },
    background: '#ffffff',
    foreground: '#0a0a0a',
    brand: '#2341e0',
    tile: '#f1f1f1',
    darkBackground: '#0a0a0a',
  },
  playful: {
    label: 'Playful',
    description: 'Rounded, friendly and bright. Good for gifts, kids and everyday treats.',
    defaults: { corners: 'round', fonts: 'friendly', cards: 'framed' },
    background: '#fff8f1',
    foreground: '#2b2140',
    brand: '#7c3aed',
    tile: '#fdeee0',
    darkBackground: '#1c1528',
  },
};

/** Classic's dark background; each look has its own (`LookInfo.darkBackground`). */
export const DARK_BACKGROUND = '#0b1f27';

export const CORNERS: Record<CornerKey, { label: string; description: string }> = {
  square: { label: 'Square', description: 'Sharp edges' },
  soft: { label: 'Soft', description: 'Slightly rounded' },
  round: { label: 'Round', description: 'Pill buttons, rounded pictures' },
};

export const FONTS: Record<FontKey, { label: string; description: string }> = {
  classic: { label: 'Classic', description: 'A warm, soft serif (Fraunces)' },
  modern: { label: 'Modern', description: 'A clean, confident sans (Geist)' },
  elegant: { label: 'Elegant', description: 'A high-contrast serif (Playfair Display)' },
  friendly: { label: 'Friendly', description: 'A rounded, open sans (Nunito)' },
};

export const CARDS: Record<CardKey, { label: string; description: string }> = {
  standard: { label: 'Standard', description: 'Picture on a soft tile, with an add-to-bag button' },
  minimal: { label: 'Minimal', description: 'Just the picture, name and price' },
  framed: { label: 'Framed', description: 'Each product in its own bordered card' },
};
