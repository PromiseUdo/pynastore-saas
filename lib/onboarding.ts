import { prisma as db } from '@/lib/prisma';
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions';
import { isReservedSlug } from '@/lib/tenant/reserved-slugs';

export async function bootstrapOrganization({
  name,
  slug,
  ownerUserId,
}: {
  name: string;
  slug: string;
  ownerUserId: string;
}) {
  // Last line of defence: both callers check this and show a friendly
  // message, but no org may ever be created on a reserved hostname.
  if (isReservedSlug(slug)) {
    throw new Error(`Reserved organization slug: ${slug}`);
  }

  return db.$transaction(async (tx) => {
    // 1. Create organization
    const org = await tx.organization.create({
      data: { name, slug },
    });

    // 2. Create all system roles for this org
    const createdRoles: Record<string, string> = {}; // roleName -> roleId

    for (const [, roleConfig] of Object.entries(SYSTEM_ROLES)) {
      // Fetch permission IDs for this role's keys
      const permissions = await tx.permission.findMany({
        where: { key: { in: roleConfig.permissions as string[] } },
        select: { id: true },
      });

      const role = await tx.role.create({
        data: {
          organizationId: org.id,
          name: roleConfig.name,
          isSystem: roleConfig.isSystem,
          rolePermissions: {
            create: permissions.map((p) => ({ permissionId: p.id })),
          },
        },
      });

      createdRoles[roleConfig.name] = role.id;
    }

    // 3. Create Owner membership for the user who created the org
    const ownerRoleId = createdRoles['Owner'];
    const membership = await tx.membership.create({
      data: {
        userId: ownerUserId,
        organizationId: org.id,
        roleId: ownerRoleId,
        status: 'ACTIVE',
      },
    });

    return { organization: org, membership };
  });
}
