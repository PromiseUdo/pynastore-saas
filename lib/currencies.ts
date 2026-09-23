/*
 * lib/currencies.ts
 *
 * The currencies a business can trade in.
 *
 * Only naira today. Organization.currency exists so that adding one is a
 * settings change rather than a migration — but nothing converts amounts
 * already recorded, so Settings → General shows the currency rather than
 * offering to switch it.
 *
 * Kept out of features/settings/organization.ts because that file is
 * `'use server'`, and such a file may only export async functions.
 */
export const SUPPORTED_CURRENCIES = [{ code: 'NGN', label: 'Nigerian naira (₦)' }] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
