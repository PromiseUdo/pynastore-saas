/*
 * lib/session.ts
 *
 * Utilities for updating the Auth.js JWT session without a full re-authentication.
 * Must only be called from server actions or route handlers (contexts that can set cookies).
 */
import { unstable_update } from '@/auth';

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
}
