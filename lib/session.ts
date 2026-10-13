/*
 * lib/session.ts
 *
 * Utilities for updating the Auth.js JWT session without a full re-authentication.
 * Must only be called from server actions or route handlers (contexts that can set cookies).
 */
import { cookies } from 'next/headers';
import { unstable_update } from '@/auth';
import { BUSINESS_SHOP_COOKIE } from '@/lib/tenant/business';
import { isBusinessRequest } from '@/lib/tenant/here';

/**
 * Updates the current org embedded in the JWT so the session reflects
 * the newly active organization. Call this after org creation or switching.
 *
 * @param _userId - The user ID (kept for call-site clarity, not used directly)
 * @param orgId   - The new active organization ID
 * @param orgSlug - The new active organization URL slug
 */
export async function updateCurrentOrganization(
  _userId: string,
  orgId: string,
  orgSlug: string,
): Promise<void> {
  await unstable_update({
    currentOrganizationId: orgId,
    currentOrgSlug: orgSlug,
  } as any);
  // The business host keeps its shop in a cookie of its own too (ROADMAP 19.1,
  // see BUSINESS_SHOP_COOKIE for why the JWT alone isn't enough there).
  if (await isBusinessRequest()) {
    (await cookies()).set(BUSINESS_SHOP_COOKIE, orgSlug, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  }
}
