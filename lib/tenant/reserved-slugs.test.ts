/* Slugs that would collide with a platform route or hostname are refused at creation. */
import { describe, expect, it } from 'vitest';
import { isReservedSlug } from './reserved-slugs';

describe('isReservedSlug', () => {
  it('refuses the console and the suspended-workspace page (ROADMAP 11, 11.4)', () => {
    expect(isReservedSlug('platform')).toBe(true);
    expect(isReservedSlug('unavailable')).toBe(true);
    expect(isReservedSlug(' Unavailable ')).toBe(true);
  });

  it('refuses storefront-looking slugs and allows ordinary ones', () => {
    expect(isReservedSlug('shop-anything')).toBe(true);
    expect(isReservedSlug('adaeze-fabrics')).toBe(false);
  });
});
