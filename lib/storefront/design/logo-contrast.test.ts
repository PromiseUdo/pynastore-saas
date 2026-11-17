/* Will a logo disappear on the shop's dark mode? (the dark-mode logo) */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { logoHiddenOnDark } from './logo-contrast';
import { StoreLogo } from '@/components/storefront/layout/store-logo';

/** An image of `n` pixels: `share` of them transparent, the rest this colour. */
function image(rgb: [number, number, number], share: number, n = 400): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(...rgb, i < n * share ? 0 : 255);
  return out;
}

describe('logoHiddenOnDark', () => {
  it('warns about a dark logo on a transparent background', () => {
    expect(logoHiddenOnDark(image([20, 20, 20], 0.6))).toBe(true);
    expect(logoHiddenOnDark(image([10, 30, 90], 0.5))).toBe(true); // navy
  });

  it('is happy with a light or bright logo on transparent', () => {
    expect(logoHiddenOnDark(image([255, 255, 255], 0.6))).toBe(false);
    expect(logoHiddenOnDark(image([250, 200, 40], 0.6))).toBe(false); // saffron
  });

  it('is happy with a logo that brings its own background', () => {
    expect(logoHiddenOnDark(image([20, 20, 20], 0))).toBe(false);
    expect(logoHiddenOnDark(image([20, 20, 20], 0.05))).toBe(false);
  });

  it('says nothing about an empty or fully transparent image', () => {
    expect(logoHiddenOnDark([])).toBe(false);
    expect(logoHiddenOnDark(image([0, 0, 0], 1))).toBe(false);
  });
});

describe('StoreLogo', () => {
  it('carries both versions, so the theme switch needs no script', () => {
    const html = renderToStaticMarkup(createElement(StoreLogo, { src: '/a.png', darkSrc: '/b.png', alt: 'Ada' }));
    expect(html).toContain('data-has-dark');
    expect(html).toContain('sf-logo-default');
    expect(html).toContain('sf-logo-dark');
  });

  it('without a dark version, marks itself for the light backing', () => {
    const html = renderToStaticMarkup(createElement(StoreLogo, { src: '/a.png', alt: 'Ada' }));
    expect(html).not.toContain('data-has-dark');
    expect(html).not.toContain('sf-logo-dark');
  });
});
