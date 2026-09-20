/*
 * Storefront theme plumbing, shared by the server layout and the client
 * toggle.
 *
 * The storefront is CREAM (light) by default; `dark` is the opt-in. The palette
 * is scoped to the `[data-storefront]` wrapper (see storefront.css) rather than
 * `.dark` on <html>, so it can never leak into the admin/marketing design
 * system — which is also why next-themes isn't used here.
 *
 * The preference rides in a COOKIE rather than localStorage so the server can
 * stamp `data-sf-theme` during SSR. The obvious alternative — an inline
 * pre-paint script reading localStorage — costs a `<script>` inside the React
 * tree (which React warns about on hydration) and still can't tell the server
 * anything. With a cookie there is no flash, no extra script, and no
 * client/server mismatch.
 *
 * This is a plain module, NOT `'use client'`: a client module's exports can
 * only be rendered or passed as props from the server, never *called* there,
 * and the layout needs to call these.
 */

export type SfTheme = 'dark' | 'light';

export const DEFAULT_SF_THEME: SfTheme = 'light';

/**
 * Per-tenant cookie name. Subdomain storefronts are already isolated by host,
 * but the mobile origin serves every tenant from ONE host under /s/{slug} —
 * without the slug they would share a single preference there.
 */
export function themeCookieName(orgSlug: string): string {
  return `sf-theme-${orgSlug}`;
}

export function parseTheme(value: string | undefined): SfTheme {
  return value === 'dark' ? 'dark' : DEFAULT_SF_THEME;
}

/** One year, site-wide. Not sensitive, and it must survive a browser restart. */
export function themeCookie(orgSlug: string, theme: SfTheme): string {
  return `${themeCookieName(orgSlug)}=${theme}; path=/; max-age=31536000; samesite=lax`;
}
