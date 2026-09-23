/*
 * lib/brand.ts
 *
 * The platform's own name, in one place. Anything a merchant or a member of
 * staff reads — page titles, the auth screens, the invite page, platform
 * emails — says this.
 *
 * It is deliberately NOT used on the storefront: a shopper is a customer of
 * the merchant's store, not of MansaaS, and those pages and emails carry the
 * merchant's name instead (see emails/storefront-reset-password.tsx).
 */
export const PLATFORM_NAME = 'MansaaS';
