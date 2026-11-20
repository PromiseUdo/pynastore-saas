import { describe, expect, it } from 'vitest';
import { NIGERIAN_STATES } from './nigeria';
import { KNOWN_AREAS, NIGERIAN_LGAS, findLga, knownAreasIn, lgasOf } from './nigeria-lgas';

/* Each state's official LGA count; they add up to 774. */
const COUNTS: Record<string, number> = {
  Abia: 17, Adamawa: 21, 'Akwa Ibom': 31, Anambra: 21, Bauchi: 20, Bayelsa: 8, Benue: 23, Borno: 27,
  'Cross River': 18, Delta: 25, Ebonyi: 13, Edo: 18, Ekiti: 16, Enugu: 17, 'Federal Capital Territory': 6,
  Gombe: 11, Imo: 27, Jigawa: 27, Kaduna: 23, Kano: 44, Katsina: 34, Kebbi: 21, Kogi: 21, Kwara: 16,
  Lagos: 20, Nasarawa: 13, Niger: 25, Ogun: 20, Ondo: 18, Osun: 30, Oyo: 33, Plateau: 17, Rivers: 23,
  Sokoto: 23, Taraba: 16, Yobe: 17, Zamfara: 14,
};

describe('Nigeria’s LGAs (25.1)', () => {
  it('has every state, each with its official number of LGAs, 774 in all, no repeats', () => {
    for (const state of NIGERIAN_STATES) {
      expect(NIGERIAN_LGAS[state], state).toHaveLength(COUNTS[state]);
      expect(new Set(NIGERIAN_LGAS[state]).size, state).toBe(COUNTS[state]);
    }
    expect(Object.values(NIGERIAN_LGAS).reduce((n, list) => n + list.length, 0)).toBe(774);
  });

  it('points every well-known place at a real LGA of its own state', () => {
    for (const [state, areas] of Object.entries(KNOWN_AREAS)) {
      for (const [area, lga] of Object.entries(areas!)) expect(lgasOf(state), `${area} → ${lga}`).toContain(lga);
    }
  });

  it('reads an LGA however it’s typed, and a well-known place as its LGA', () => {
    expect(findLga('Lagos', 'surulere')).toBe('Surulere');
    expect(findLga('Lagos', 'Eti-Osa LGA')).toBe('Eti Osa');
    expect(findLga('Lagos', 'Lekki')).toBe('Eti Osa');
    expect(findLga('Lagos', 'Bode thomas')).toBe('Surulere');
    expect(findLga('Federal Capital Territory', 'Wuse 2')).toBe('Abuja Municipal Area Council');
    expect(findLga('Oyo', 'Surulere')).toBe('Surulere'); // Oyo has one too
  });

  it('never guesses: an unknown name, or a place in another state, is null', () => {
    expect(findLga('Lagos', 'Nowhere Town')).toBeNull();
    expect(findLga('Rivers', 'Lekki')).toBeNull();
  });

  it('lists the known places in an LGA, for searching', () => {
    expect(knownAreasIn('Lagos', 'Surulere')).toContain('Bode Thomas');
  });
});
