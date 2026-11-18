/*
 * lib/brand.ts
 *
 * The platform's own name, in one place (ROADMAP 12.2). Anything a merchant,
 * a member of staff or a reader of the legal pages sees — page titles, the
 * auth screens, the dashboard's wording, platform emails, the Terms and the
 * Privacy Policy — reads it from here, so renaming the platform is a change
 * to this file (and the native app's display name, see MOBILE.md).
 *
 * "Pynastore" at pynastore.com is the platform's name, agreed by the owner on
 * 2026-11-16. It replaced the working name used until then, which is gone
 * from the code entirely — nothing was ever live under it.
 *
 * On the storefront it appears ONCE, as the quiet "Powered by" credit
 * (components/storefront/layout/powered-by.tsx, decided 2026-11-18).
 * Everything else there — a shopper is a customer of the merchant's store,
 * not of the platform — carries the merchant's name instead, emails too
 * (see emails/storefront-reset-password.tsx).
 *
 * Also deliberately NOT renamed: internal identifiers that happen to say
 * "mansaas" — browser storage keys (`mansaas:sf:…`), token issuers and
 * audiences, the social-token key salt, the Cloudinary folder, billing
 * references (`mansaas_…`), the Paystack subaccount metadata, and the
 * mobile app id `com.mansaas.app`. Nobody reads them, and changing any of
 * them would sign people out, empty saved bags, orphan stored images or
 * payments, or make the app a different app in the stores.
 */
export const PLATFORM_NAME = 'Pynastore';

/** The platform's public domain — the marketing site and the legal pages. */
export const PLATFORM_DOMAIN = 'pynastore.com';

/** Who operates the platform, as the legal pages name it. */
export const PLATFORM_OPERATOR = 'Pynacode';

/** The operator's registration, as the legal pages state it. */
export const PLATFORM_OPERATOR_REGISTRATION = 'CAC business name registration number 9663547';

/** Where people write to us — the site footer and the legal pages. */
export const PLATFORM_CONTACT_EMAIL = 'business@pynacode.com';

/** Where visitors and merchants get help (ROADMAP 23): the website chat's fallback and the footer's contact. */
export const PLATFORM_SUPPORT_EMAIL = 'business@pynacode.com';

/** The business app's name in the stores and on the phone (ROADMAP 19): one app for every merchant. */
export const BUSINESS_APP_NAME = `${PLATFORM_NAME} Business`;
