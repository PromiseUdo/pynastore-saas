'use server';

/* Workspaces are created only through /onboarding ("Create your shop",
 * ROADMAP 12.5), where the merchant chooses the web address and the first
 * store. */

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateCurrentOrganization } from '@/lib/session';
import { getAdminUrl } from '@/lib/tenant/urls';

type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

/**
 * Switch the current user's active organization.
 * Validates membership before updating the JWT. Redirects to the new org's dashboard.
 */
export async function switchOrganization(orgId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const membership = await prisma.membership.findFirst({
    where: {
      userId: session.user.id,
      organizationId: orgId,
      status: 'ACTIVE',
      organization: { status: 'ACTIVE' },
    },
    select: {
      organization: { select: { id: true, slug: true } },
    },
  });

  if (!membership) {
    return { success: false, error: 'Organization not found or access denied.' };
  }

  await updateCurrentOrganization(
    session.user.id,
    membership.organization.id,
    membership.organization.slug,
  );

  redirect(getAdminUrl(membership.organization.slug, '/dashboard'));
}
