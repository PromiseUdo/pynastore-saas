import { describe, expect, it } from 'vitest';
import {
  STORE_PLACE_LOCKED_MESSAGE,
  cleanCity,
  formatStorePlace,
  hasStorePlace,
  storePlaceProblem,
} from './store-place';

describe('cleanCity', () => {
  it('trims and single-spaces what the merchant typed, keeping their spelling', () => {
    expect(cleanCity('  Port   Harcourt ')).toBe('Port Harcourt');
  });

  it('treats blank as no city', () => {
    expect(cleanCity('   ')).toBeNull();
    expect(cleanCity(null)).toBeNull();
    expect(cleanCity(undefined)).toBeNull();
  });
});

describe('hasStorePlace / formatStorePlace', () => {
  it('needs both halves', () => {
    expect(hasStorePlace({ state: 'Rivers', city: 'Port Harcourt' })).toBe(true);
    expect(hasStorePlace({ state: 'Rivers', city: null })).toBe(false);
    expect(hasStorePlace({ state: null, city: 'Port Harcourt' })).toBe(false);
  });

  it('reads city first, then state', () => {
    expect(formatStorePlace({ state: 'Lagos', city: 'Ikeja' })).toBe('Ikeja, Lagos');
    expect(formatStorePlace({ state: 'Lagos', city: null })).toBeNull();
  });
});

describe('storePlaceProblem', () => {
  it('accepts a full place', () => {
    expect(storePlaceProblem({ state: 'Rivers', city: 'Port Harcourt' }, true)).toBeNull();
  });

  it('accepts no place at all for a store that does not sell online', () => {
    expect(storePlaceProblem({ state: null, city: null }, false)).toBeNull();
    expect(storePlaceProblem({ state: '', city: '  ' }, false)).toBeNull();
  });

  it('refuses to leave a store that sells online without a place', () => {
    expect(storePlaceProblem({ state: null, city: null }, true)).toEqual({
      field: 'state',
      message: STORE_PLACE_LOCKED_MESSAGE,
    });
  });

  it('wants state and city together', () => {
    expect(storePlaceProblem({ state: 'Rivers', city: '' }, false)?.field).toBe('city');
    expect(storePlaceProblem({ state: null, city: 'Port Harcourt' }, false)?.field).toBe('state');
  });

  it('only takes a state from the Nigerian list, spelled as delivery zones spell it', () => {
    expect(storePlaceProblem({ state: 'Rivers State', city: 'Port Harcourt' }, false)?.field).toBe('state');
    expect(storePlaceProblem({ state: 'Federal Capital Territory', city: 'Abuja' }, false)).toBeNull();
  });

  it('caps the city length', () => {
    expect(storePlaceProblem({ state: 'Lagos', city: 'a'.repeat(101) }, false)?.field).toBe('city');
  });
});
