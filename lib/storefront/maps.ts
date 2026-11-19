/*
 * A link that opens the shop's address in a map, for directions.
 *
 * Google's documented "Maps URLs" form (no key needed): on a phone it opens
 * the Maps app when installed, otherwise maps.google.com. The address is the
 * merchant's own text from Business details, passed through as typed.
 */
export function mapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.replace(/\s+/g, ' ').trim())}`;
}
