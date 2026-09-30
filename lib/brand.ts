/*
 * lib/brand.ts
 *
 * The platform's own name, in one place (ROADMAP 12.2). Anything a merchant,
 * a member of staff or a reader of the legal pages sees — page titles, the
 * auth screens, the dashboard's wording, platform emails, the Terms and the
 * Privacy Policy — reads it from here, so renaming the platform is a change
 * to this file (and the native app's display name, see MOBILE.md).
 *
 * "Notely" at getnotely.io is the working name, chosen 2026-09-30 while the
 * final name is still being decided.
 *
 * It is deliberately NOT used on the storefront: a shopper is a customer of
 * the merchant's store, not of the platform, and those pages and emails carry
 * the merchant's name instead (see emails/storefront-reset-password.tsx).
 *
 * Also deliberately NOT renamed: internal identifiers that happen to say
 * "mansaas" — browser storage keys (`mansaas:sf:…`), token issuers and
 * audiences, the social-token key salt, the Cloudinary folder, billing
 * references (`mansaas_…`), the Paystack subaccount metadata, and the
 * mobile app id `com.mansaas.app`. Nobody reads them, and changing any of
 * them would sign people out, empty saved bags, orphan stored images or
 * payments, or make the app a different app in the stores.
 */
export const PLATFORM_NAME = 'Notely';

/** The platform's public domain — the marketing site and the legal pages. */
export const PLATFORM_DOMAIN = 'getnotely.io';

/** Who operates the platform, as the legal pages name it. */
export const PLATFORM_OPERATOR = 'Pynacode';

/** The operator's registration, as the legal pages state it. */
export const PLATFORM_OPERATOR_REGISTRATION = 'CAC business name registration number 9663547';

/** Where people write to us — the site footer and the legal pages. */
export const PLATFORM_CONTACT_EMAIL = 'pynacode@gmail.com';
