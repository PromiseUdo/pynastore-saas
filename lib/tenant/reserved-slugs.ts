/*
 * lib/tenant/reserved-slugs.ts
 *
 * Org slugs that may not be handed out, because the hostname they would claim
 * already means something else.
 *
 * Every platform hostname is one label under ROOT_DOMAIN
 * (see lib/tenant/resolveHostname.ts), so a slug IS a hostname:
 *
 *   slug "app"        -> app.{ROOT_DOMAIN}, the platform/sign-in host
 *   slug "m"          -> m.{ROOT_DOMAIN}, the mobile origin
 *   slug "www"        -> www.{ROOT_DOMAIN}, marketing
 *   slug "shop-rite"  -> shop-rite.{ROOT_DOMAIN}, which resolveHostname reads
 *                        as the STOREFRONT of an org called "rite"
 *
 * The last one is why the prefix rule exists and is not merely cosmetic: a
 * slug beginning with the storefront prefix makes one tenant's admin host
 * indistinguishable from another tenant's storefront.
 *
 * This guards slug CREATION. Existing rows are left alone — renaming an
 * organization would break every link, bookmark and OAuth return URL that
 * already points at it. See the migration notes in AGENTS.md.
 */

/** Hostnames the platform itself uses or keeps in reserve. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'app',
  'www',
  'm',
  'shop',
  'api',
  'admin',
  'mail',
  'static',
  'assets',
]);

/** Slug prefixes that would collide with a storefront hostname. */
export const RESERVED_SLUG_PREFIXES: readonly string[] = ['shop-'];

export function isReservedSlug(slug: string): boolean {
  const value = slug.trim().toLowerCase();
  if (!value) return false;
  if (RESERVED_SLUGS.has(value)) return true;
  return RESERVED_SLUG_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/** The message a merchant sees. Plain language, says what to do next. */
export const RESERVED_SLUG_MESSAGE =
  'That web address is reserved. Please choose a different organization name.';
