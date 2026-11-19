import { describe, expect, it } from 'vitest';
import { mapsHref } from './maps';

describe('mapsHref', () => {
  it('opens the address as typed, on one line', () => {
    expect(mapsHref('12 Admiralty Way,\nLekki Phase 1,  Lagos')).toBe(
      'https://www.google.com/maps/search/?api=1&query=12%20Admiralty%20Way%2C%20Lekki%20Phase%201%2C%20Lagos',
    );
  });
});
