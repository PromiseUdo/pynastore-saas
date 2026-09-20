'use server';

import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS, PermissionDeniedError } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { z } from 'zod';

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

const UpdateRoleSchema = z.object({
  membershipId: z.string().min(1),
  roleId: z.string().min(1),
});

const RemoveMemberSchema = z.object({
  membershipId: z.string().min(1),
});

/**
 * Change a member's role within the organization.
 * Requires STAFF_MANAGE permission.
 * Cannot demote the last Owner.
 */
export async function updateMemberRole(
  input: z.infer<typeof UpdateRoleSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.STAFF_MANAGE);

    const parsed = UpdateRoleSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const { membershipId, roleId } = parsed.data;

    // Verify membership belongs to this org
    const membership = await prisma.membership.findFirst({
      where: { id: membershipId, organizationId: ctx.organization.id, status: 'ACTIVE' },
      select: {
        id: true,
        userId: true,
        role: { select: { id: true, name: true } },
      },
    });

    if (!membership) {
      return { success: false, error: 'Member not found.' };
    }

    // Verify new role belongs to this org
    const newRole = await prisma.role.findFirst({
      where: { id: roleId, organizationId: ctx.organization.id },
      select: { id: true, name: true },
    });

    if (!newRole) {
      return { success: false, error: 'Role not found.' };
    }

    // Prevent demoting the last Owner
    if (membership.role.name === 'Owner' && newRole.name !== 'Owner') {
      const ownerCount = await prisma.membership.count({
        where: {
          organizationId: ctx.organization.id,
          status: 'ACTIVE',
          role: { name: 'Owner' },
        },
      });

      if (ownerCount <= 1) {
        return { success: false, error: 'Cannot change the role of the last Owner.' };
      }
    }

    await prisma.membership.update({
      where: { id: membershipId },
      data: { roleId },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'staff.member.role_changed',
      entityType: 'Membership',
      entityId: membershipId,
      metadata: {
        targetUserId: membership.userId,
        oldRoleId: membership.role.id,
        oldRoleName: membership.role.name,
        newRoleId: newRole.id,
        newRoleName: newRole.name,
      },
    });

    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return { success: false, error: 'You do not have permission to manage members.' };
    }
    console.error('[updateMemberRole]', err);
    return { success: false, error: 'Failed to update role. Please try again.' };
  }
}

/**
 * Remove a member from the organization by suspending their membership.
 * Requires STAFF_MANAGE permission.
 * Cannot remove yourself if you are the last Owner.
 */
export async function removeMember(
  input: z.infer<typeof RemoveMemberSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.STAFF_MANAGE);

    const parsed = RemoveMemberSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const { membershipId } = parsed.data;

    const membership = await prisma.membership.findFirst({
      where: { id: membershipId, organizationId: ctx.organization.id, status: 'ACTIVE' },
      select: {
        id: true,
        userId: true,
        role: { select: { name: true } },
      },
    });

    if (!membership) {
      return { success: false, error: 'Member not found.' };
    }

    // Cannot remove the last Owner (even by self)
    if (membership.role.name === 'Owner') {
      const ownerCount = await prisma.membership.count({
        where: {
          organizationId: ctx.organization.id,
          status: 'ACTIVE',
          role: { name: 'Owner' },
        },
      });

      if (ownerCount <= 1) {
        return { success: false, error: 'Cannot remove the last Owner. Transfer ownership first.' };
      }
    }

    await prisma.membership.update({
      where: { id: membershipId },
      data: { status: 'SUSPENDED' },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'staff.member.removed',
      entityType: 'Membership',
      entityId: membershipId,
      metadata: { targetUserId: membership.userId },
    });

    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return { success: false, error: 'You do not have permission to remove members.' };
    }
    console.error('[removeMember]', err);
    return { success: false, error: 'Failed to remove member. Please try again.' };
  }
}
