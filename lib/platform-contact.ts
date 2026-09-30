/*
 * lib/platform-contact.ts
 *
 * The address merchants are told to write to about their account — shown on
 * the "workspace suspended" page and in the suspension email (ROADMAP 11.4).
 * Server only. PLATFORM_SUPPORT_EMAIL, falling back to the staff inbox.
 */
export function platformSupportEmail(): string | null {
  const email = (process.env.PLATFORM_SUPPORT_EMAIL || process.env.PLATFORM_ADMIN_EMAIL || '').trim();
  return email || null;
}
