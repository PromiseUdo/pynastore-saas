/*
 * Which store sends which part of a bag (ROADMAP Phase 9.3). Pure — the same
 * code checkout's quote and order placement run, and the stock hold follows.
 */
import { describe, expect, it } from 'vitest';
import type { StoreDeliverySetup, ZoneSetup } from './match';
import {
  combineParcelChoice,
  defaultParcelChoice,
  parcelChoiceId,
  planOrder,
  planWithAnyStock,
  resolveDeliveryChoice,
  type BagLine,
  type StockByStore,
} from './plan';

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
  rates: [],
  ...over,
});

const pickup = (id: string, city: string, state: string) => ({
  id,
  name: id,
  address: '1 Shop Road',
  city,
  state,
  instructions: null,
  readyMinutes: 1440,
  readyUnit: 'DAYS' as const,
  price: 0,
  isActive: true,
});

/* Port Harcourt: cheap locally, dearer to the rest of Nigeria. */
const PH: StoreDeliverySetup = {
  warehouseId: 'ph',
  name: 'Port Harcourt',
  state: 'Rivers',
  zones: [
    zone({ id: 'ph-local', kind: 'CITIES', name: 'Within Port Harcourt', state: 'Rivers', cities: ['Port Harcourt'], rates: [rate('ph-local', 150_000), rate('ph-express', 300_000, { minMinutes: 0, maxMinutes: 0 })] }),
    zone({ id: 'ph-rest', kind: 'NATIONWIDE', name: 'Rest of Nigeria', rates: [rate('ph-rest', 500_000)] }),
  ],
  pickups: [pickup('ph-counter', 'Port Harcourt', 'Rivers')],
};

/* Lagos: cheap locally, ₦4,500 to Port Harcourt. */
const LAGOS: StoreDeliverySetup = {
  warehouseId: 'lagos',
  name: 'Lagos',
  state: 'Lagos',
  zones: [
    zone({ id: 'lagos-local', kind: 'CITIES', name: 'Within Lagos', state: 'Lagos', cities: ['Ikeja'], rates: [rate('lagos-local', 120_000)] }),
    zone({ id: 'lagos-rest', kind: 'NATIONWIDE', name: 'Rest of Nigeria', rates: [rate('lagos-rest', 450_000, { minMinutes: 2880, maxMinutes: 7200 })] }),
  ],
  pickups: [pickup('lekki-counter', 'Lekki', 'Lagos')],
};

const PH_ADDRESS = { state: 'Rivers', city: 'Port Harcourt' };
const line = (itemId: string, quantity = 1, unitPrice = 1_000_000): BagLine => ({ itemId, quantity, unitPrice });
const deliveryIds = (q: ReturnType<typeof planOrder>) => q.options.filter((o) => o.kind === 'delivery').map((o) => o.id);
const storesOf = (q: ReturnType<typeof planOrder>, id: string) => q.plans[id].shipments.map((s) => s.store.id);

describe('one store with the whole bag', () => {
  it('sends a Port Harcourt order from Port Harcourt at the local price', () => {
    const stock: StockByStore = { ph: { tee: 5 }, lagos: { tee: 50 } };
    const quote = planOrder([PH, LAGOS], stock, [line('tee')], PH_ADDRESS);
    expect(deliveryIds(quote)).toEqual(['rate_ph-local', 'rate_ph-express']);
    expect(storesOf(quote, 'rate_ph-local')).toEqual(['ph']);
    expect(quote.zone?.name).toBe('Within Port Harcourt');
  });

  it('charges the Lagos → Port Harcourt price when only Lagos has it', () => {
    const quote = planOrder([PH, LAGOS], { lagos: { lamp: 3 } }, [line('lamp')], PH_ADDRESS);
    expect(deliveryIds(quote)).toEqual(['rate_lagos-rest']);
    expect(quote.options[0].price).toBe(450_000);
    expect(storesOf(quote, 'rate_lagos-rest')).toEqual(['lagos']);
  });

  it('prefers a store in the shopper’s state when two cost the same', () => {
    const twin: StoreDeliverySetup = { ...LAGOS, warehouseId: 'abuja', name: 'Abuja', state: 'Federal Capital Territory', zones: [zone({ id: 'abuja-rest', kind: 'NATIONWIDE', rates: [rate('abuja-rest', 450_000)] })] };
    const kanoStore: StoreDeliverySetup = { ...twin, warehouseId: 'kano', name: 'Kano', state: 'Kano', zones: [zone({ id: 'kano-rest', kind: 'NATIONWIDE', rates: [rate('kano-rest', 450_000)] })] };
    const stock: StockByStore = { abuja: { tee: 1 }, kano: { tee: 1 } };
    const quote = planOrder([twin, kanoStore], stock, [line('tee')], { state: 'Kano', city: 'Kano' });
    expect(deliveryIds(quote)).toEqual(['rate_kano-rest']);
  });

  it('never uses a store that doesn’t deliver to the address, whatever it holds', () => {
    const localOnly: StoreDeliverySetup = { ...LAGOS, zones: [LAGOS.zones[0]] };
    const quote = planOrder([PH, localOnly], { lagos: { lamp: 3 } }, [line('lamp')], PH_ADDRESS);
    expect(quote.options.filter((o) => o.kind === 'delivery')).toEqual([]);
    expect(quote.reason).toBe('not-in-stock-here');
  });
});

describe('a bag no single store holds', () => {
  const stock: StockByStore = { ph: { tee: 5 }, lagos: { lamp: 2 } };
  const bag = [line('tee'), line('lamp', 1, 500_000)];

  it('comes back as parcels, biggest first, each with its own store’s options', () => {
    const quote = planOrder([PH, LAGOS], stock, bag, PH_ADDRESS);
    expect(quote.parcels.map((p) => [p.store.id, p.lines, p.options.map((o) => o.id)])).toEqual([
      ['ph', [{ itemId: 'tee', quantity: 1 }], ['rate_ph-local', 'rate_ph-express']],
      ['lagos', [{ itemId: 'lamp', quantity: 1 }], ['rate_lagos-rest']],
    ]);
    // Delivery is chosen per parcel, so no single delivery option is listed.
    expect(quote.options.filter((o) => o.kind === 'delivery')).toEqual([]);
  });

  it('preselects each parcel’s cheapest option, and adds each store’s trip up', () => {
    const quote = planOrder([PH, LAGOS], stock, bag, PH_ADDRESS);
    const choice = defaultParcelChoice(quote.parcels)!;
    expect(choice).toBe('rate_ph-local+rate_lagos-rest');

    const method = combineParcelChoice(quote.parcels, choice)!;
    expect(method.price).toBe(150_000 + 450_000);
    expect(method.label).toBe('ph-local + lagos-rest · 2 parcels');
    expect(method.description).toBe('Sent in 2 parcels, from Port Harcourt and Lagos');
    // Delivered when the slower parcel arrives.
    expect(method.eta).toEqual({ minMinutes: 2880, maxMinutes: 7200, unit: 'DAYS' });
    expect(method.parcels?.map((p) => [p.storeName, p.label, p.price, p.itemIds])).toEqual([
      ['Port Harcourt', 'ph-local', 150_000, ['tee']],
      ['Lagos', 'lagos-rest', 450_000, ['lamp']],
    ]);
  });

  it('lets the shopper choose each parcel on its own, and resolves that to a plan', () => {
    const quote = planOrder([PH, LAGOS], stock, bag, PH_ADDRESS);
    const resolved = resolveDeliveryChoice(quote, parcelChoiceId(['rate_ph-express', 'rate_lagos-rest']))!;
    expect(resolved.method.price).toBe(300_000 + 450_000);
    expect(resolved.plan.shipments.map((s) => [s.store.id, s.method.id])).toEqual([
      ['ph', 'rate_ph-express'],
      ['lagos', 'rate_lagos-rest'],
    ]);
  });

  it('refuses a choice that doesn’t fit the parcels', () => {
    const quote = planOrder([PH, LAGOS], stock, bag, PH_ADDRESS);
    for (const id of [
      'rate_ph-local', // one parcel's option alone
      'rate_lagos-rest+rate_ph-local', // the right options, the wrong parcels
      'rate_ph-local+rate_lagos-rest+rate_ph-express', // too many
      'rate_ph-local+rate_made-up',
    ]) {
      expect(resolveDeliveryChoice(quote, id), id).toBeNull();
      expect(combineParcelChoice(quote.parcels, id), id).toBeNull();
    }
  });

  it('splits one line only when no single store has enough of it', () => {
    const quote = planOrder([PH, LAGOS], { ph: { tee: 3 }, lagos: { tee: 2 } }, [line('tee', 5)], PH_ADDRESS);
    expect(quote.parcels.map((p) => [p.store.id, p.lines[0].quantity])).toEqual([
      ['ph', 3],
      ['lagos', 2],
    ]);
  });

  it('says so when the stores that deliver here can’t cover the bag between them', () => {
    const quote = planOrder([PH, LAGOS], { ph: { tee: 1 } }, [line('tee', 2)], PH_ADDRESS);
    expect(quote.options).toEqual([]);
    expect(quote.parcels).toEqual([]);
    expect(quote.reason).toBe('not-in-stock-here');
  });

  it('says it’s the address, not the bag, when no store delivers there', () => {
    const noRest: StoreDeliverySetup = { ...PH, zones: [PH.zones[0]], pickups: [] };
    const quote = planOrder([noRest], { ph: { tee: 5 } }, [line('tee')], { state: 'Kano', city: 'Kano' });
    expect(quote.reason).toBe('no-delivery');
  });

  it('checks each parcel’s free-delivery threshold against that parcel alone', () => {
    const generous: StoreDeliverySetup = {
      ...PH,
      zones: [zone({ id: 'ph-local', kind: 'CITIES', state: 'Rivers', cities: ['Port Harcourt'], rates: [rate('ph-local', 150_000, { freeOver: 1_500_000 })] })],
    };
    // ₦10,000 from PH (under ₦15,000) + a ₦10,000 lamp from Lagos: the whole bag clears the bar, the PH parcel doesn't.
    const quote = planOrder([generous, LAGOS], stock, [line('tee'), line('lamp')], PH_ADDRESS);
    expect(combineParcelChoice(quote.parcels, defaultParcelChoice(quote.parcels)!)!.price).toBe(150_000 + 450_000);
  });
});

describe('pickup', () => {
  it('is offered only where that store holds the whole bag, and sends everything from there', () => {
    const quote = planOrder([PH, LAGOS], { ph: { tee: 5 }, lagos: { tee: 5, lamp: 1 } }, [line('tee'), line('lamp')], PH_ADDRESS);
    const pickups = quote.options.filter((o) => o.kind === 'pickup').map((o) => o.id);
    expect(pickups).toEqual(['pickup_lekki-counter']);
    expect(storesOf(quote, 'pickup_lekki-counter')).toEqual(['lagos']);
  });
});

describe('the admin’s address check', () => {
  it('picks the cheapest store to send from when every store has the items', () => {
    const quote = planWithAnyStock([PH, LAGOS], PH_ADDRESS, 0);
    const first = quote.options.find((o) => o.kind === 'delivery')!;
    expect(quote.plans[first.id].shipments[0].store.name).toBe('Port Harcourt');
  });
});

/* ROADMAP Phase 9.7: the merchant may bring a split bag together at one store. */
describe('brought together at one store', () => {
  const TOGETHER = { fee: 100_000, leadMinutes: 2 * 1440, leadUnit: 'DAYS' as const };
  const stock: StockByStore = { ph: { tee: 5 }, lagos: { lamp: 2 } };
  const bag = [line('tee'), line('lamp', 1, 500_000)];

  it('sends one parcel from the store that delivers, bringing the rest to it first', () => {
    const quote = planOrder([PH, LAGOS], stock, bag, PH_ADDRESS, TOGETHER);
    expect(quote.parcels).toHaveLength(1);
    const [parcel] = quote.parcels;
    expect(parcel.store.id).toBe('ph');
    expect(parcel.sources).toEqual([{ store: { id: 'lagos', name: 'Lagos' }, lines: [{ itemId: 'lamp', quantity: 1 }] }]);

    const [cheapest] = quote.options;
    // Port Harcourt's own ₦1,500 plus ₦1,000 for bringing from Lagos; two days more.
    expect(cheapest.price).toBe(150_000 + 100_000);
    expect(cheapest.label).toBe('ph-local · brought together');
    expect(cheapest.description).toBe('Items from Lagos are brought to Port Harcourt first, then sent as one parcel');
    expect(cheapest.eta).toEqual({ minMinutes: 1440 + 2880, maxMinutes: 4320 + 2880, unit: 'DAYS' });
    expect(cheapest.consolidatedFrom).toEqual(['Lagos']);
    expect(quote.plans[cheapest.id].shipments[0].sources?.[0].store.id).toBe('lagos');
  });

  it('gathers where the fewest stores need to send anything', () => {
    // Lagos holds both the lamp and a tee, so gathering in Lagos needs nothing brought.
    const quote = planOrder([PH, LAGOS], { ph: { tee: 5 }, lagos: { lamp: 2, tee: 1 } }, bag, PH_ADDRESS, TOGETHER);
    // One store has everything, so this isn't a split at all — a plain Lagos parcel.
    expect(quote.parcels[0].store.id).toBe('lagos');
    expect(quote.parcels[0].sources).toBeUndefined();
  });

  it('offers a pickup where the bag can be gathered, with the fee and the time on top', () => {
    const quote = planOrder([PH, LAGOS], stock, bag, PH_ADDRESS, TOGETHER);
    const ph = quote.options.find((o) => o.id === 'pickup_ph-counter')!;
    expect(ph.price).toBe(100_000);
    expect(ph.eta.minMinutes).toBe(1440 + 2880);
    expect(quote.plans[ph.id].shipments[0].sources?.map((s) => s.store.id)).toEqual(['lagos']);
  });

  it('still sends separate parcels when the merchant hasn’t chosen to bring bags together', () => {
    expect(planOrder([PH, LAGOS], stock, bag, PH_ADDRESS).parcels).toHaveLength(2);
  });

  it('can gather stock from a store that doesn’t deliver there itself', () => {
    const localLagos: StoreDeliverySetup = { ...LAGOS, zones: [LAGOS.zones[0]] };
    const quote = planOrder([PH, localLagos], stock, bag, PH_ADDRESS, TOGETHER);
    expect(quote.reason).toBeNull();
    expect(quote.parcels[0].store.id).toBe('ph');
  });
});
