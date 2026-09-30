/*
 * lib/onboarding/business.ts
 *
 * What a merchant tells us about their business at sign-up (ROADMAP 12.5).
 * Pure and client-safe. Used ONLY to order the setup guide and to offer
 * starter categories the merchant can tick or skip — never to create
 * products, pages or storefront copy (Storefront data rules: never invent a
 * merchant's content). A category is the merchant's own filing, and only
 * the ones they tick are made.
 */

export const SALES_CHANNELS = {
  ONLINE: { label: 'Online', description: 'Customers order from your online shop' },
  IN_PERSON: { label: 'In person', description: 'Customers buy at your counter or market stall' },
  BOTH: { label: 'Both', description: 'Online and in person' },
} as const;

export type SalesChannels = keyof typeof SALES_CHANNELS;

export function isSalesChannels(value: unknown): value is SalesChannels {
  return typeof value === 'string' && Object.hasOwn(SALES_CHANNELS, value);
}

export const BUSINESS_TYPES = {
  fashion: { label: 'Fashion and clothing', categories: ['Women', 'Men', 'Children', 'Shoes', 'Bags', 'Accessories'] },
  beauty: { label: 'Beauty and personal care', categories: ['Skincare', 'Hair care', 'Makeup', 'Fragrance', 'Body care'] },
  groceries: { label: 'Food and groceries', categories: ['Drinks', 'Snacks', 'Food cupboard', 'Fresh food', 'Household'] },
  electronics: { label: 'Phones and electronics', categories: ['Phones', 'Accessories', 'Computers', 'Audio', 'Home appliances'] },
  home: { label: 'Home and furniture', categories: ['Furniture', 'Kitchen', 'Bedding', 'Decor', 'Lighting'] },
  health: { label: 'Health and pharmacy', categories: ['Medicines', 'Vitamins and supplements', 'First aid', 'Personal care'] },
  books: { label: 'Books and stationery', categories: ['Books', 'Stationery', 'School supplies', 'Office supplies'] },
  other: { label: 'Something else', categories: [] },
} as const satisfies Record<string, { label: string; categories: readonly string[] }>;

export type BusinessType = keyof typeof BUSINESS_TYPES;

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === 'string' && Object.hasOwn(BUSINESS_TYPES, value);
}

/** The starter categories on offer for a business type — the merchant picks from these. */
export function suggestedCategories(type: BusinessType): readonly string[] {
  return BUSINESS_TYPES[type].categories;
}

/** Keeps only names that were on offer, once each, in the offered order. */
export function acceptedCategories(type: BusinessType, picked: string[]): string[] {
  const offered = suggestedCategories(type);
  return offered.filter((name) => picked.includes(name));
}
