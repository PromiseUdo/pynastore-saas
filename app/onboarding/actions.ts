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
});

export type OnboardingState = { error: string } | null;

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 48);
}

export async function createOrganizationAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const parsed = CreateOrgSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { name } = parsed.data;
  let slug = toSlug(name);

  if (!slug) {
    return { error: 'Organization name must contain at least one letter or number.' };
  }

  // The slug becomes a hostname ({slug}.{ROOT_DOMAIN}), so it can't be one
  // the platform already answers on — see lib/tenant/reserved-slugs.ts.
  if (isReservedSlug(slug)) {
    return { error: RESERVED_SLUG_MESSAGE };
  }

  // Ensure slug uniqueness — append a short random suffix if taken
  const taken = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (taken) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const { organization } = await bootstrapOrganization({
    name,
    slug,
    ownerUserId: session.user.id,
  });

  await updateCurrentOrganization(session.user.id, organization.id, organization.slug);

  redirect(getAdminUrl(organization.slug, '/dashboard'));
}
