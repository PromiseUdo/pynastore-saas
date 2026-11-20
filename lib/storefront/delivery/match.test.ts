/*
 * Which delivery options a shopper gets for an address. Pure — the same code
 * checkout, order placement and the admin's "check an address" run.
 */
import { describe, expect, it } from 'vitest';
import { normalizePlace, parsePlaceList } from '@/lib/geo/nigeria';
import {
  deliveryFor,
  hasAnyDelivery,
  offeredTo,
  qualifiesForArranged,
  matchZone,
  neighbourhoodsIn,
  quoteEachStore,
  quoteFromSetup,
  type DeliverySetup,
  type StoreDeliverySetup,
  type ZoneSetup,
} from './match';

const rate = (id: string, price: number, over: Partial<ZoneSetup['rates'][number]> = {}) => ({
  id,
  name: id,
  price,
  minMinutes: 1440,
  maxMinutes: 4320,
  etaUnit: 'DAYS' as const,
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

const PH = zone({ id: 'ph', name: 'Within Port Harcourt', kind: 'CITIES', state: 'Rivers', cities: ['Port Harcourt', 'Obio-Akpor'], rates: [rate('ph-local', 150_000), rate('ph-same-day', 300_000, { minMinutes: 0, maxMinutes: 0 })] });
const SOUTH = zone({ id: 'south', name: 'South-South', kind: 'STATES', states: ['Rivers', 'Bayelsa', 'Delta'], rates: [rate('south-standard', 300_000)] });
const REST = zone({ id: 'rest', name: 'Rest of Nigeria', kind: 'NATIONWIDE', rates: [rate('rest-standard', 500_000), rate('rest-express', 900_000)] });
const SHOP = {
  id: 'shop',
  name: 'Main shop',
  address: '12 Aba Road',
  city: 'Port Harcourt',
  state: 'Rivers',
  instructions: 'Ask at the counter',
  readyMinutes: 1440,
  readyUnit: 'DAYS' as const,
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

  it('ignores a merchant describing the area instead of naming it', () => {
    expect(normalizePlace('Within Abakaliki')).toBe('abakaliki');
    expect(normalizePlace('inside Lagos Island')).toBe('lagos island');
    expect(normalizePlace('Aba and environs')).toBe('aba');
    expect(normalizePlace('Greater Port Harcourt area')).toBe('port harcourt');
    // a real name that merely contains the words is left alone
    expect(normalizePlace('Ikot Ekpene')).toBe('ikot ekpene');
  });

  it('cleans a merchant’s list and drops duplicates', () => {
    expect(parsePlaceList('Port Harcourt, port-harcourt ,Obio-Akpor,\nEleme,, ')).toEqual(['Port Harcourt', 'Obio-Akpor', 'Eleme']);
  });
});

/* ROADMAP Phase 9.2: each store has its own delivery; ./plan.test.ts covers which one sends an order. */
describe('delivery from several stores', () => {
  const PH_STORE: StoreDeliverySetup = { warehouseId: 'ph-store', name: 'Port Harcourt', zones: [PH, REST], pickups: [SHOP] };
  const LAGOS_STORE: StoreDeliverySetup = {
    warehouseId: 'lagos-store',
    name: 'Lagos',
    zones: [zone({ id: 'lagos-to-rivers', name: 'Rivers', kind: 'STATES', states: ['Rivers'], rates: [rate('interstate', 450_000)] })],
    pickups: [],
  };

  it('asks every store on its own', () => {
    const quotes = quoteEachStore([PH_STORE, LAGOS_STORE], { state: 'Rivers', city: 'Port Harcourt' }, 0);
    expect(quotes.map((q) => [q.store.name, q.zone?.name])).toEqual([
      ['Port Harcourt', 'Within Port Harcourt'],
      ['Lagos', 'Rivers'],
    ]);
  });
});

describe('delivery for wholesalers (ROADMAP 21.4A)', () => {
  const setup: DeliverySetup = {
    zones: [
      zone({
        id: 'ng',
        kind: 'NATIONWIDE',
        rates: [
          rate('standard', 350_000, { freeOver: 5_000_000, tradeFreeOver: 50_000_000 }),
          rate('bike', 700_000, { audience: 'RETAIL' }),
          rate('van', 1_500_000, { audience: 'TRADE' }),
        ],
      }),
    ],
    pickups: [
      { id: 'shop', name: 'Shop', address: '1 Road', city: 'Aba', state: 'Abia', instructions: null, readyMinutes: 0, readyUnit: 'DAYS', price: 0, isActive: true },
      { id: 'gate', name: 'Warehouse gate', address: '2 Road', city: 'Aba', state: 'Abia', instructions: null, readyMinutes: 0, readyUnit: 'DAYS', price: 0, isActive: true, audience: 'TRADE' },
    ],
  };
  const ids = (s: DeliverySetup) => [...s.zones[0].rates.map((r) => r.id), ...s.pickups.map((p) => p.id)];

  it('offers each buyer only what is meant for them', () => {
    expect(ids(deliveryFor(setup, 'retail'))).toEqual(['standard', 'bike', 'shop']);
    expect(ids(deliveryFor(setup, 'trade'))).toEqual(['standard', 'van', 'shop', 'gate']);
    expect(offeredTo(undefined, 'trade')).toBe(true);
    expect(offeredTo('RETAIL', 'trade')).toBe(false);
    expect(offeredTo('TRADE', 'retail')).toBe(false);
  });

  it('gives a wholesaler their own free-delivery threshold, and everyone else the usual one', () => {
    const address = { state: 'Lagos', city: 'Ikeja' };
    const at = (buyer: 'retail' | 'trade', subtotal: number) =>
      quoteFromSetup(deliveryFor(setup, buyer), address, subtotal).options.find((o) => o.id === 'rate_standard')!.price;
    expect(at('retail', 6_000_000)).toBe(0);
    expect(at('trade', 6_000_000)).toBe(350_000);
    expect(at('trade', 50_000_000)).toBe(0);
  });

  it('falls back to the usual threshold for trade when the merchant set none', () => {
    const plain: DeliverySetup = { zones: [zone({ id: 'ng', kind: 'NATIONWIDE', rates: [rate('std', 350_000, { freeOver: 100 })] })], pickups: [] };
    expect(deliveryFor(plain, 'trade').zones[0].rates[0].freeOver).toBe(100);
  });
});

describe('delivery to be arranged: which bags qualify (ROADMAP 21.4B)', () => {
  it('needs either amount reached, and nothing when the store offers it to no size', () => {
    const rule = { fromValue: 50_000_000, fromItems: 100, withinHours: 24 };
    expect(qualifiesForArranged(rule, { value: 50_000_000, items: 1 })).toBe(true);
    expect(qualifiesForArranged(rule, { value: 100, items: 100 })).toBe(true);
    expect(qualifiesForArranged(rule, { value: 49_999_999, items: 99 })).toBe(false);
    expect(qualifiesForArranged({ fromValue: null, fromItems: null, withinHours: 24 }, { value: 1e12, items: 1e6 })).toBe(false);
    expect(qualifiesForArranged(null, { value: 1e12, items: 1e6 })).toBe(false);
  });
});

describe('matching by LGA (ROADMAP 25.1)', () => {
  // AurafumeNG's zone, as it was typed before LGAs: the neighbourhoods, not "Surulere".
  const SURULERE = zone({ id: 'z-surulere', kind: 'CITIES', name: 'Surulere', state: 'Lagos', cities: ['Bode thomas', 'ojuelegba', 'aguda', 'kilo'] });
  const ETI_OSA = zone({ id: 'z-island', kind: 'CITIES', name: 'Island', state: 'Lagos', cities: ['Eti Osa'] });
  const lagos: DeliverySetup = { zones: [SURULERE, ETI_OSA], pickups: [] };

  it('finds a zone of neighbourhoods for a shopper who gives the LGA (the Surulere bug)', () => {
    expect(matchZone(lagos, { state: 'Lagos', city: 'Surulere' })?.id).toBe('z-surulere');
  });

  it('finds an LGA zone for a well-known place in it, however it’s typed', () => {
    expect(matchZone(lagos, { state: 'Lagos', city: 'Lekki' })?.id).toBe('z-island');
    expect(matchZone(lagos, { state: 'Lagos', city: 'eti-osa' })?.id).toBe('z-island');
    expect(matchZone(lagos, { state: 'Lagos', city: 'Aguda' })?.id).toBe('z-surulere');
  });

  it('keeps an LGA in its own state: Oyo’s Surulere isn’t Lagos’s', () => {
    expect(matchZone(lagos, { state: 'Oyo', city: 'Surulere' })).toBeNull();
  });

  it('still matches a name that isn’t an LGA or a known place only by itself, as before', () => {
    const custom = zone({ id: 'z-estate', kind: 'CITIES', name: 'Estate', state: 'Lagos', cities: ['Sunshine Estate'] });
    const s: DeliverySetup = { zones: [custom], pickups: [] };
    expect(matchZone(s, { state: 'Lagos', city: 'sunshine estate' })?.id).toBe('z-estate');
    expect(matchZone(s, { state: 'Lagos', city: 'Surulere' })).toBeNull();
  });
});

describe('neighbourhood prices inside an LGA (ROADMAP 25.2)', () => {
  const NEAR = zone({ id: 'near', kind: 'CITIES', state: 'Lagos', cities: ['Surulere'], areas: ['Bode Thomas', 'Ojuelegba'] });
  const FAR = zone({ id: 'far', kind: 'CITIES', state: 'Lagos', cities: ['Surulere'], areas: ['Aguda', 'Ijesha'] });
  const REST_OF = zone({ id: 'surulere', kind: 'CITIES', state: 'Lagos', cities: ['Surulere'] });
  const LAGOS = zone({ id: 'lagos', kind: 'STATES', states: ['Lagos'] });
  const shop: DeliverySetup = { zones: [LAGOS, REST_OF, FAR, NEAR], pickups: [] };
  const at = (area?: string) => matchZone(shop, { state: 'Lagos', city: 'Surulere', area })?.id;

  it('prices the neighbourhood the shopper picked, ahead of the whole LGA', () => {
    expect(at('Bode Thomas')).toBe('near');
    expect(at('aguda')).toBe('far');
  });

  it('gives "somewhere else", or no pick, the whole-LGA price', () => {
    expect(at('')).toBe('surulere');
    expect(at(undefined)).toBe('surulere');
    expect(at('Masha')).toBe('surulere');
  });

  it('falls through to the state when only neighbourhoods are priced', () => {
    const partly: DeliverySetup = { zones: [LAGOS, NEAR], pickups: [] };
    expect(matchZone(partly, { state: 'Lagos', city: 'Surulere', area: 'Bode Thomas' })?.id).toBe('near');
    expect(matchZone(partly, { state: 'Lagos', city: 'Surulere' })?.id).toBe('lagos');
  });

  it('never applies a neighbourhood in another LGA', () => {
    expect(matchZone(shop, { state: 'Lagos', city: 'Ikeja', area: 'Bode Thomas' })?.id).toBe('lagos');
  });

  it('lists the shop’s neighbourhoods in an LGA, in its order, across stores — and none where it prices the whole LGA', () => {
    const otherStore: DeliverySetup = { zones: [zone({ id: 'x', kind: 'CITIES', state: 'Lagos', cities: ['Surulere'], areas: ['Kilo', 'aguda'] })], pickups: [] };
    expect(neighbourhoodsIn([shop, otherStore], 'Lagos', 'Surulere')).toEqual(['Aguda', 'Ijesha', 'Bode Thomas', 'Ojuelegba', 'Kilo']);
    expect(neighbourhoodsIn([shop], 'Lagos', 'Ikeja')).toEqual([]);
  });
});
