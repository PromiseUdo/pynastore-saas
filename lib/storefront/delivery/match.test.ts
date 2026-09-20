/*
 * Which delivery options a shopper gets for an address. Pure — the same code
 * checkout, order placement and the admin's "check an address" run.
 */
import { describe, expect, it } from 'vitest';
import { normalizePlace, parsePlaceList } from '@/lib/geo/nigeria';
import { hasAnyDelivery, matchZone, quoteFromSetup, type DeliverySetup, type ZoneSetup } from './match';

const rate = (id: string, price: number, over: Partial<ZoneSetup['rates'][number]> = {}) => ({
  id,
  name: id,
  price,
  minDays: 1,
  maxDays: 3,
  freeOver: null,
  isActive: true,
  ...over,
});

const zone = (over: Partial<ZoneSetup> & Pick<ZoneSetup, 'id' | 'kind'>): ZoneSetup => ({
  name: over.id,
  state: null,
  states: [],
  cities: [],
  isActive: true,
  rates: [rate(`${over.id}-standard`, 100_000)],
  ...over,
});

const PH = zone({ id: 'ph', name: 'Within Port Harcourt', kind: 'CITIES', state: 'Rivers', cities: ['Port Harcourt', 'Obio-Akpor'], rates: [rate('ph-local', 150_000), rate('ph-same-day', 300_000, { minDays: 0, maxDays: 0 })] });
const SOUTH = zone({ id: 'south', name: 'South-South', kind: 'STATES', states: ['Rivers', 'Bayelsa', 'Delta'], rates: [rate('south-standard', 300_000)] });
const REST = zone({ id: 'rest', name: 'Rest of Nigeria', kind: 'NATIONWIDE', rates: [rate('rest-standard', 500_000), rate('rest-express', 900_000)] });
const SHOP = {
  id: 'shop',
  name: 'Main shop',
  address: '12 Aba Road',
  city: 'Port Harcourt',
  state: 'Rivers',
  instructions: 'Ask at the counter',
  readyInDays: 1,
  price: 0,
  isActive: true,
};

const setup: DeliverySetup = { zones: [REST, SOUTH, PH], pickups: [SHOP] };

describe('matching an address to a zone', () => {
  it('prefers a city zone, then a state zone, then the rest of Nigeria — whatever order they were created in', () => {
    expect(matchZone(setup, { state: 'Rivers', city: 'Port Harcourt' })?.id).toBe('ph');
    expect(matchZone(setup, { state: 'Rivers', city: 'Bonny' })?.id).toBe('south');
    expect(matchZone(setup, { state: 'Bayelsa', city: 'Yenagoa' })?.id).toBe('south');
    expect(matchZone(setup, { state: 'Lagos', city: 'Ikeja' })?.id).toBe('rest');
  });

  it('matches the city however the shopper typed it', () => {
    for (const city of ['port harcourt', ' Port-Harcourt ', 'PORT HARCOURT CITY', 'obio akpor']) {
      expect(matchZone(setup, { state: 'Rivers', city })?.id, city).toBe('ph');
    }
  });

  it('never matches a city zone in a different state with the same city name', () => {
    expect(matchZone(setup, { state: 'Lagos', city: 'Port Harcourt' })?.id).toBe('rest');
  });

  it('skips zones that are switched off, falling back to the next one', () => {
    const off = { ...setup, zones: [REST, SOUTH, { ...PH, isActive: false }] };
    expect(matchZone(off, { state: 'Rivers', city: 'Port Harcourt' })?.id).toBe('south');
  });

  it('matches nothing when no zone covers the address and there is no rest-of-Nigeria zone', () => {
    const local = { zones: [PH], pickups: [] };
    expect(matchZone(local, { state: 'Lagos', city: 'Ikeja' })).toBeNull();
    expect(quoteFromSetup(local, { state: 'Lagos', city: 'Ikeja' }, 0)).toEqual({ zone: null, options: [] });
  });
});

describe('quoting', () => {
  it('offers only the matched zone’s active options, cheapest first, then every pickup point', () => {
    const quote = quoteFromSetup(setup, { state: 'Rivers', city: 'Port Harcourt' }, 1_000_000);
    expect(quote.zone).toEqual({ id: 'ph', name: 'Within Port Harcourt' });
    expect(quote.options.map((o) => [o.id, o.kind, o.price])).toEqual([
      ['rate_ph-local', 'delivery', 150_000],
      ['rate_ph-same-day', 'delivery', 300_000],
      ['pickup_shop', 'pickup', 0],
    ]);
    expect(quote.options[2].pickup).toMatchObject({ name: 'Main shop', city: 'Port Harcourt' });
  });

  it('offers pickup to shoppers anywhere, even where there is no delivery', () => {
    const quote = quoteFromSetup({ zones: [PH], pickups: [SHOP] }, { state: 'Kano', city: 'Kano' }, 0);
    expect(quote.zone).toBeNull();
    expect(quote.options.map((o) => o.id)).toEqual(['pickup_shop']);
  });

  it('makes an option free once the goods reach its threshold, and says what it would have cost', () => {
    const withThreshold = {
      zones: [zone({ id: 'rest', kind: 'NATIONWIDE', rates: [rate('std', 500_000, { freeOver: 5_000_000 })] })],
      pickups: [],
    };
    const below = quoteFromSetup(withThreshold, { state: 'Lagos', city: 'Ikeja' }, 4_999_999).options[0];
    const at = quoteFromSetup(withThreshold, { state: 'Lagos', city: 'Ikeja' }, 5_000_000).options[0];
    expect([below.price, below.freeOver]).toEqual([500_000, 5_000_000]);
    expect([at.price, at.regularPrice]).toEqual([0, 500_000]);
  });

  it('leaves out switched-off options and pickups', () => {
    const quote = quoteFromSetup(
      { zones: [zone({ id: 'rest', kind: 'NATIONWIDE', rates: [rate('a', 1, { isActive: false }), rate('b', 2)] })], pickups: [{ ...SHOP, isActive: false }] },
      { state: 'Lagos', city: '' },
      0,
    );
    expect(quote.options.map((o) => o.id)).toEqual(['rate_b']);
  });

  it('knows whether a store can take orders at all', () => {
    expect(hasAnyDelivery({ zones: [], pickups: [] })).toBe(false);
    expect(hasAnyDelivery({ zones: [zone({ id: 'z', kind: 'NATIONWIDE', rates: [] })], pickups: [] })).toBe(false);
    expect(hasAnyDelivery({ zones: [], pickups: [SHOP] })).toBe(true);
    expect(hasAnyDelivery(setup)).toBe(true);
  });
});

describe('place names', () => {
  it('treats spelling differences that don’t change the place as the same place', () => {
    expect(normalizePlace('Port-Harcourt City')).toBe('port harcourt');
    expect(normalizePlace('Obio/Akpor LGA')).toBe('obio akpor');
  });

  it('cleans a merchant’s list and drops duplicates', () => {
    expect(parsePlaceList('Port Harcourt, port-harcourt ,Obio-Akpor,\nEleme,, ')).toEqual(['Port Harcourt', 'Obio-Akpor', 'Eleme']);
  });
});
