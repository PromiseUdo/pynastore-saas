import { describe, expect, it } from 'vitest';
import { checkBrandColour, contrast, darkModeShade, hoverOf, textOn, DARK_TEXT, LIGHT_TEXT } from './colour';
import { DARK_BACKGROUND, LOOKS, LOOK_KEYS } from './looks';
import { DESIGN_VERSION, classicDesign, parseDesign, sameDesign, type StorefrontDesignConfig } from './schema';
import { resolveDesign } from './tokens';

const design = (over: Partial<StorefrontDesignConfig> = {}): StorefrontDesignConfig => ({
  version: DESIGN_VERSION,
  look: 'minimal',
  brandColour: null,
  darkByDefault: false,
  corners: null,
  fonts: null,
  cards: null,
  sections: null,
  header: { layout: 'standard' },
  footer: null,
  startingLook: null,
  ...over,
});

describe('colour', () => {
  it('measures contrast the WCAG way', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('puts whichever text reads better on a colour', () => {
    expect(textOn('#b42318')).toBe(LIGHT_TEXT);
    expect(textOn('#ffda29')).toBe(DARK_TEXT);
  });

  it('darkens under white text and lightens under dark text on hover', () => {
    expect(contrast(hoverOf('#2341e0'), '#000000')).toBeLessThan(contrast('#2341e0', '#000000'));
    expect(contrast(hoverOf('#ffda29'), '#000000')).toBeGreaterThan(contrast('#ffda29', '#000000'));
  });

  it('accepts a colour that reads on the look’s background, and lifts it for dark mode', () => {
    const red = checkBrandColour('#b42318', LOOKS.classic.background, DARK_BACKGROUND);
    expect(red).toMatchObject({ ok: true, text: LIGHT_TEXT });
    if (!red.ok) return;
    // A deep red would sink into a dark page: dark mode gets a lighter red.
    expect(red.dark).not.toBe('#b42318');
    expect(contrast(red.dark, DARK_BACKGROUND)).toBeGreaterThanOrEqual(3);
    expect(contrast(textOn(red.dark), red.dark)).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves a colour that already stands out in the dark as it is', () => {
    expect(darkModeShade('#ffda29', DARK_BACKGROUND)).toBe('#ffda29');
  });

  it('refuses a colour too light to stand out, and offers a darker shade that passes', () => {
    const result = checkBrandColour('#ffd6e0', LOOKS.minimal.background, DARK_BACKGROUND);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/too light/);
    expect(result.suggestion).toMatch(/^#[0-9a-f]{6}$/);
    expect(checkBrandColour(result.suggestion!, LOOKS.minimal.background, DARK_BACKGROUND).ok).toBe(true);
  });

  it('refuses something that isn’t a colour', () => {
    expect(checkBrandColour('red; background:url(x)', '#ffffff', DARK_BACKGROUND)).toMatchObject({ ok: false });
  });

  it('has every look’s own colour pass its own rule, and lift readably onto its own dark background', () => {
    for (const key of LOOK_KEYS) {
      const check = checkBrandColour(LOOKS[key].brand, LOOKS[key].background, LOOKS[key].darkBackground);
      expect(check.ok, key).toBe(true);
      if (check.ok) expect(contrast(check.dark, LOOKS[key].darkBackground), key).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('parseDesign', () => {
  it('reads a valid design and normalises the colour', () => {
    expect(parseDesign({ ...design(), brandColour: '#B42318' })?.brandColour).toBe('#b42318');
  });

  it('treats anything it can’t read as missing, never as half a design', () => {
    expect(parseDesign(null)).toBeNull();
    expect(parseDesign('minimal')).toBeNull();
    expect(parseDesign({ ...design(), look: 'neon' })).toBeNull();
    expect(parseDesign({ ...design(), brandColour: 'red' })).toBeNull();
    expect(parseDesign({ ...design(), css: 'body{display:none}' })).toBeNull(); // strict: no extra keys
    expect(parseDesign({ ...design(), version: 99 })).toBeNull();
  });

  it('builds Classic from what a shop set before designs existed', () => {
    expect(classicDesign({ accent: '#B42318', darkByDefault: true })).toEqual(
      design({ look: 'classic', brandColour: '#b42318', darkByDefault: true }),
    );
    expect(classicDesign({ accent: 'not-a-colour', darkByDefault: false }).brandColour).toBeNull();
  });

  it('compares choices, not object identity', () => {
    expect(sameDesign(design(), design())).toBe(true);
    expect(sameDesign(design(), design({ cards: 'framed' }))).toBe(false);
  });
});

describe('resolveDesign', () => {
  it('gives Classic with no colour exactly today’s storefront: classic attributes, no inline style', () => {
    const resolved = resolveDesign(classicDesign({ accent: null, darkByDefault: false }));
    expect(resolved.attributes).toEqual({
      'data-sf-look': 'classic',
      'data-sf-corners': 'round',
      'data-sf-fonts': 'classic',
      'data-sf-cards': 'standard',
    });
    expect(resolved.style).toEqual({});
  });

  it('takes the look’s own choices unless Fine-tune overrides one', () => {
    const resolved = resolveDesign(design({ look: 'editorial', cards: 'framed' }));
    expect(resolved.attributes['data-sf-fonts']).toBe('elegant');
    expect(resolved.attributes['data-sf-corners']).toBe('square');
    expect(resolved.attributes['data-sf-cards']).toBe('framed');
  });

  it('sends the colour, its text and hover as tokens, and a readable shade of it for dark mode', () => {
    const style = resolveDesign(design({ brandColour: '#b42318' })).style;
    expect(style['--merchant-brand']).toBe('#b42318');
    expect(style['--merchant-brand-fg']).toBe(LIGHT_TEXT);
    // lifted against THIS look's own dark background (minimal: graphite)
    expect(style['--merchant-brand-dark']).toBe(darkModeShade('#b42318', LOOKS.minimal.darkBackground));
    expect(style['--merchant-brand-dark-fg']).toBe(textOn(style['--merchant-brand-dark']));
  });
});
