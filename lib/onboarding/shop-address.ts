/*
 * lib/onboarding/shop-address.ts
 *
 * The rules for a shop's web address (its slug): what the merchant may
 * choose, and what to suggest when it's taken (ROADMAP 12.5). Pure and
 * client-safe; the server checks availability against the database.
 *
 * The address becomes two hostnames — `{slug}.{root}` (the dashboard) and
 * `shop-{slug}.{root}` (the storefront) — and never changes afterwards,
 * because links customers saved must keep working (AGENTS §7). So it is the
 * merchant's to choose, it is never suffixed behind their back, and a taken
 * one is answered with suggestions.
 */
import { isReservedSlug } from '@/lib/tenant/reserved-slugs';

export const ADDRESS_MIN = 3;
export const ADDRESS_MAX = 40;

/** A name or a typed address, turned into address form: "Ada's Fabrics" → "adas-fabrics". */
export function toShopAddress(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, ADDRESS_MAX)
    .replace(/-+$/g, '');
}

export type AddressProblem = 'too-short' | 'too-long' | 'invalid' | 'reserved';

/** Why an address can't be used, before asking whether it's taken — or null. */
export function addressProblem(address: string): AddressProblem | null {
  if (address.length < ADDRESS_MIN) return 'too-short';
  if (address.length > ADDRESS_MAX) return 'too-long';
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(address) || address.includes('--')) return 'invalid';
  if (isReservedSlug(address)) return 'reserved';
  return null;
}

export const ADDRESS_PROBLEM_MESSAGE: Record<AddressProblem | 'taken', string> = {
  'too-short': `Use at least ${ADDRESS_MIN} letters or numbers.`,
  'too-long': `Keep it to ${ADDRESS_MAX} characters.`,
  invalid: 'Use lowercase letters, numbers and single hyphens, starting and ending with a letter or number.',
  reserved: 'That address is kept for the platform itself. Try another.',
  taken: 'Another shop already has that address.',
};

/**
 * Other addresses to offer when one is taken, best first: the city, a
 * shop/store word, then numbers. Only candidates that pass the rules; the
 * caller removes the taken ones.
 */
export function addressCandidates(address: string, city?: string | null): string[] {
  const base = address.slice(0, ADDRESS_MAX - 8).replace(/-+$/g, '');
  const place = city ? toShopAddress(city) : '';
  const raw = [
    place ? `${base}-${place}` : '',
    place ? `${place}-${base}` : '',
    `${base}-shop`,
    `${base}-store`,
    `the-${base}`,
    `${base}-ng`,
    ...[1, 2, 3, 4, 5].map((n) => `${base}${n}`),
  ];
  const seen = new Set<string>();
  return raw.filter((c) => {
    if (!c || c === address || seen.has(c) || addressProblem(c)) return false;
    seen.add(c);
    return true;
  });
}
