/*
 * lib/geo/nigeria.ts
 *
 * Nigeria's states, and how place names typed by people are compared.
 *
 * Shared by the storefront's address form and the admin's delivery zones, so
 * the state a shopper picks is always spelled exactly as the merchant's zone
 * spells it. Client-safe: data and pure functions only.
 */

/** All 36 states plus the FCT, alphabetical — a select, not free text. */
export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
  'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'Federal Capital Territory', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano',
  'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun',
  'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe',
  'Zamfara',
] as const;

export type NigerianState = (typeof NIGERIAN_STATES)[number];

export function isNigerianState(value: string): value is NigerianState {
  return (NIGERIAN_STATES as readonly string[]).includes(value);
}

/**
 * A city or area name reduced to what matters for matching what a shopper
 * typed against what a merchant typed: "Port-Harcourt ", "port harcourt" and
 * "Port Harcourt City" are the same place. Case, punctuation, repeated spaces
 * and a trailing "city"/"town"/"LGA" don't distinguish places here.
 */
export function normalizePlace(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(city|town|lga|local government area|metropolis)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A merchant's comma- or newline-separated list of places, cleaned up and de-duplicated. */
export function parsePlaceList(value: string | string[]): string[] {
  const parts = Array.isArray(value) ? value : value.split(/[,\n]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const label = part.trim().replace(/\s+/g, ' ');
    const key = normalizePlace(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}
