'use server';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { bootstrapOrganization } from '@/lib/onboarding';
import { updateCurrentOrganization } from '@/lib/session';
import { getAdminUrl } from '@/lib/tenant/urls';
import { isReservedSlug, RESERVED_SLUG_MESSAGE } from '@/lib/tenant/reserved-slugs';
import { z } from 'zod';

const CreateOrgSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50),
  slug: z.string().min(2).max(50).optional(),
  userId: z.string().optional(),
});

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 48);
}

/**
 * Create a new organization for the current user.
 * Bootstraps all system roles and creates Owner membership in one transaction.
 * Then updates the JWT so the new org is immediately active.
 */
export async function createOrganization(input: {
  name: string;
  slug?: string;
  userId?: string;
}): Promise<ActionResult<{ slug: string }>> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const parsed = CreateOrgSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { name } = parsed.data;
  const userId = input.userId ?? session.user.id;

  let slug = input.slug ?? toSlug(name);
  if (!slug) {
    return { success: false, error: 'Organization name must contain at least one letter or number.' };
  }

  // The slug becomes a hostname ({slug}.{ROOT_DOMAIN}), so it can't be one
  // the platform already answers on — see lib/tenant/reserved-slugs.ts.
  if (isReservedSlug(slug)) {
    return { success: false, error: RESERVED_SLUG_MESSAGE };
  }

  const taken = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (taken) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const { organization } = await bootstrapOrganization({ name, slug, ownerUserId: userId });

  await updateCurrentOrganization(userId, organization.id, organization.slug);

  return { success: true, data: { slug: organization.slug } };
}

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
