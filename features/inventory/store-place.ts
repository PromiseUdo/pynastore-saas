// features/inventory/store-place.ts
// Where a store is: a Nigerian state and a city (ROADMAP Phase 9.1). Pure and
// client-safe, shared by the server actions (which enforce the rules) and the
// store dialog, list and header (which explain them before anyone hits one).
//
// THE RULES
//   - State and city go together: a state alone can't tell Port Harcourt from
//     Bonny, and a city alone is ambiguous across states.
//   - A store needs both before it may start selling online, because delivery
//     is priced from where a parcel leaves (Phase 9.2).
//   - A store that sold online before this rule existed keeps selling; the
//     admin asks for its place instead of switching it off mid-order.
//
// The state is spelled exactly as lib/geo/nigeria spells it, the same list the
// delivery zones and the checkout use, so a store in "Rivers" and a zone for
// "Rivers" are the same place without any fuzzy matching.
import { isNigerianState, parsePlaceList } from '@/lib/geo/nigeria';

export type StorePlace = { state: string | null; city: string | null };

export const STORE_CITY_MAX = 100;

/** Said wherever a store can't sell online yet for want of a place. */
export const STORE_PLACE_REQUIRED_MESSAGE =
  'Add the state and city this store is in first, so delivery can be priced from where orders leave.';

/** Said when someone tries to clear the place of a store that sells online. */
export const STORE_PLACE_LOCKED_MESSAGE =
  'This store sells online, so it needs a state and city. Turn off “Sells online” first to remove them.';

/** A city as the merchant typed it, tidied: trimmed, single-spaced. Empty → null. */
export function cleanCity(value: string | null | undefined): string | null {
  return parsePlaceList([value ?? ''])[0] ?? null;
}

/** Both halves are filled in. */
export function hasStorePlace(place: StorePlace): boolean {
  return Boolean(place.state && place.city);
}

/** "Port Harcourt, Rivers", or null when the store has no place yet. */
export function formatStorePlace(place: StorePlace): string | null {
  return hasStorePlace(place) ? `${place.city}, ${place.state}` : null;
}

export type StorePlaceProblem = { field: 'state' | 'city'; message: string };

/**
 * What's wrong with a place as entered, or null. `required` is true for a
 * store that sells online, which may not be left without one.
 */
export function storePlaceProblem(place: StorePlace, required: boolean): StorePlaceProblem | null {
  const state = place.state?.trim() || null;
  const city = cleanCity(place.city);

  if (state && !isNigerianState(state)) return { field: 'state', message: 'Choose a Nigerian state.' };
  if (city && city.length > STORE_CITY_MAX) {
    return { field: 'city', message: `Keep the city under ${STORE_CITY_MAX} characters.` };
  }
  if (!state && !city) {
    return required ? { field: 'state', message: STORE_PLACE_LOCKED_MESSAGE } : null;
  }
  if (!state) return { field: 'state', message: 'Choose the state this city is in.' };
  if (!city) return { field: 'city', message: 'Add the city or town the store is in.' };
  return null;
}
