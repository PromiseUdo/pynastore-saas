/*
 * lib/organization.ts
 *
 * Single source of truth for resolving the current org + membership in any
 * server context (layouts, server components, server actions).
 *
 * NEVER resolve org context ad-hoc — always call getOrganizationContext().
 * It is cached per-request via React cache() so multiple callers in the
 * same render tree share a single DB query.
 */
import { headers } from 'next/headers';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions';

const ALL_PERMISSIONS: string[] = Object.values(PERMISSIONS);

export type MembershipRole = {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: string[]; // resolved permission keys from RolePermission
};

export type OrganizationContext = {
  organization: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    plan: string;
    status: string;
  };
  membership: {
    id: string;
    role: MembershipRole;
  };
  userId: string;
};

export const getOrganizationContext = cache(
  async (): Promise<OrganizationContext> => {
    const session = await auth();

    if (!session?.user?.id) {
      redirect('/login');
    }

    // headers() is async in Next.js 15+
    const headersList = await headers();
    const orgSlug = headersList.get('x-org-slug');

    if (!orgSlug) {
      redirect('/onboarding');
    }

    const membership = await prisma.membership.findFirst({
      where: {
        userId: session.user.id,
        status: 'ACTIVE',
        organization: {
          slug: orgSlug,
          status: 'ACTIVE',
        },
      },
      select: {
        id: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            plan: true,
            status: true,
          },
        },
        role: {
          select: {
            id: true,
            name: true,
            isSystem: true,
            rolePermissions: {
              select: { permission: { select: { key: true } } },
            },
          },
        },
      },
    });

    if (!membership) {
      notFound();
    }

    /* The Owner holds every permission, including ones added to the app after
     * the organization was created. Stored role permissions are a snapshot
     * taken at onboarding, and nobody can grant a permission they don't hold
     * (features/roles/actions.ts), so without this a new permission could
     * never reach an existing store. */
    const permissions =
      membership.role.isSystem && membership.role.name === SYSTEM_ROLES.OWNER.name
        ? [...ALL_PERMISSIONS]
        : membership.role.rolePermissions.map((rp) => rp.permission.key);

    return {
      organization: membership.organization,
      membership: {
        id: membership.id,
        role: {
          id: membership.role.id,
          name: membership.role.name,
          isSystem: membership.role.isSystem,
          permissions,
        },
      },
      userId: session.user.id,
    };
  },
);

/** Shorthand when you only need the org ID to scope a query. */
export async function getOrganizationId(): Promise<string> {
  const ctx = await getOrganizationContext();
  return ctx.organization.id;
}
