import { describe, expect, it } from 'vitest';
import { isHexColour, resolveAnnouncement, safeHref } from './announcement';

const base = { style: 'BAR' as const, text: 'Christmas sale — 20% off' };

describe('resolveAnnouncement', () => {
  it('shows what the merchant wrote', () => {
    const shown = resolveAnnouncement('c1', base);
    expect(shown?.text).toBe('Christmas sale — 20% off');
    expect(shown?.style).toBe('BAR');
  });

  it('shows nothing when the merchant wrote nothing', () => {
    /* The point: no invented "Sale now on!" — a shop with nothing to say
     * announces nothing, whatever the style is set to. */
    expect(resolveAnnouncement('c1', { ...base, text: null })).toBeNull();
    expect(resolveAnnouncement('c1', { ...base, text: '   ' })).toBeNull();
    expect(resolveAnnouncement('c1', { style: 'MODAL', text: '' })).toBeNull();
  });

  it('shows nothing when the style is NONE, however much was written', () => {
    expect(resolveAnnouncement('c1', { style: 'NONE', text: 'Lots to say' })).toBeNull();
  });

  it('keeps the detail for a modal and drops it from a bar', () => {
    const detail = 'Orders for sale items ship from the 27th.';
    expect(resolveAnnouncement('c1', { style: 'MODAL', text: 'Sale', detail })?.detail).toBe(detail);
    // A bar has one line; carrying text it can't show would be a lie to the merchant.
    expect(resolveAnnouncement('c1', { ...base, detail })?.detail).toBeNull();
  });

  it('only offers a link when it has both a label and somewhere to go', () => {
    expect(resolveAnnouncement('c1', { ...base, cta: 'Shop the sale', href: '/sale' })?.cta).toEqual({
      label: 'Shop the sale',
      href: '/sale',
    });
    expect(resolveAnnouncement('c1', { ...base, cta: 'Shop', href: null })?.cta).toBeNull();
    expect(resolveAnnouncement('c1', { ...base, cta: '', href: '/sale' })?.cta).toBeNull();
  });

  it('refuses a dangerous link rather than half-fixing it', () => {
    expect(resolveAnnouncement('c1', { ...base, cta: 'Click', href: 'javascript:alert(1)' })?.cta).toBeNull();
    expect(resolveAnnouncement('c1', { ...base, cta: 'Click', href: 'http://example.com' })?.cta).toBeNull();
  });

  it('only lets a real colour through', () => {
    expect(resolveAnnouncement('c1', { ...base, background: '#b42318' })?.background).toBe('#b42318');
    expect(resolveAnnouncement('c1', { ...base, background: 'red; content:attr(x)' })?.background).toBeNull();
    expect(resolveAnnouncement('c1', { ...base, background: 'rebeccapurple' })?.background).toBeNull();
  });

  it('keeps a picture for the pop-up and not for the bar', () => {
    const image = 'https://res.cloudinary.com/demo/image/upload/v1/sale.jpg';
    expect(resolveAnnouncement('c1', { style: 'MODAL', text: 'Sale', image })?.image).toBe(image);
    // A bar is one line tall; there is nowhere to put a picture.
    expect(resolveAnnouncement('c1', { ...base, image })?.image).toBeNull();
  });

  it('only scrolls a bar', () => {
    expect(resolveAnnouncement('c1', { ...base, scroll: true })?.scroll).toBe(true);
    expect(resolveAnnouncement('c1', { style: 'MODAL', text: 'Sale', scroll: true })?.scroll).toBe(false);
  });
});

describe('safeHref', () => {
  it('allows a path in the store and an https address', () => {
    expect(safeHref('/collections/sale')).toBe('/collections/sale');
    expect(safeHref('https://example.com/sale')).toBe('https://example.com/sale');
  });

  it('refuses everything else', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://example.com', 'nonsense', '']) {
      expect(safeHref(bad)).toBeNull();
    }
  });
});

describe('isHexColour', () => {
  it('accepts #rrggbb and nothing else', () => {
    expect(isHexColour('#ffffff')).toBe(true);
    expect(isHexColour('#FFF')).toBe(false);
    expect(isHexColour('white')).toBe(false);
    expect(isHexColour(null)).toBe(false);
  });
});
