/*
 * lib/business-app/paths.ts
 *
 * The routes and deep links of the business app's trips through its in-app
 * browser sheet (ROADMAP 19.2). Shared by the routes and the app's own code,
 * so the two can't drift apart. No server-only imports.
 */

/** On the platform host, opened in the sheet: begins Google or Apple sign-in. */
export const BUSINESS_SIGN_IN_START = '/api/business/auth/start';
/** On the platform host, in the sheet: where Auth.js lands once the provider said yes. */
export const BUSINESS_SIGN_IN_FINISH = '/api/business/auth/finish';
/** On the business host, in the app's WebView: spends the ticket, sets the session. */
export const BUSINESS_SIGN_IN_HANDOFF = '/api/business/auth/handoff';
/** On the platform host, in the sheet: begins "connect Facebook" from a ticket. */
export const BUSINESS_SOCIAL_START = '/api/social/meta/app-start';

/** `com.mansaas.business://auth-return?to={handoff link}` — the sign-in coming back. */
export const AUTH_RETURN_HOST = 'auth-return';
/** `com.mansaas.business://social-return?to={page}` — the Facebook connection coming back. */
export const SOCIAL_RETURN_HOST = 'social-return';

export type BusinessSignInProvider = 'google' | 'apple';

export function isBusinessSignInProvider(value: unknown): value is BusinessSignInProvider {
  return value === 'google' || value === 'apple';
}
