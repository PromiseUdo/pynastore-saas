'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import {
  requirePermission,
  hasPermission,
  PERMISSIONS,
  PermissionDeniedError,
  type PermissionKey,
} from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export type RoleWithDetails = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  organizationId: string;
  permissionKeys: string[];
  memberCount: number;
};

// ─── Schemas ─────────────────────────────────────────────────────────────────

const PERMISSION_VALUES = Object.values(PERMISSIONS) as [PermissionKey, ...PermissionKey[]];

const CreateRoleSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name must be 50 characters or less'),
  description: z.string().max(200).optional(),
  permissionKeys: z.array(z.enum(PERMISSION_VALUES)),
});

const UpdateRoleSchema = z.object({
  roleId: z.string().min(1),
  name: z.string().min(2).max(50).optional(),
  description: z.string().max(200).optional().nullable(),
  permissionKeys: z.array(z.enum(PERMISSION_VALUES)).optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapRole(role: {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  organizationId: string;
  rolePermissions: { permission: { key: string } }[];
  _count: { memberships: number };
}): RoleWithDetails {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    organizationId: role.organizationId,
    permissionKeys: role.rolePermissions.map((rp) => rp.permission.key),
    memberCount: role._count.memberships,
  };
}

const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  isSystem: true,
  organizationId: true,
  rolePermissions: {
    select: { permission: { select: { key: true } } },
  },
  _count: {
    select: {
      memberships: { where: { status: 'ACTIVE' as const } },
    },
  },
} as const;

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function getRoles(): Promise<ActionResult<RoleWithDetails[]>> {
  try {
    const ctx = await getOrganizationContext();

    const rolesRaw = await prisma.role.findMany({
      where: { organizationId: ctx.organization.id },
      select: ROLE_SELECT,
    });

    // System roles first (sorted by name), then custom roles (sorted by name)
    const system = rolesRaw
      .filter((r) => r.isSystem)
      .sort((a, b) => a.name.localeCompare(b.name));
    const custom = rolesRaw
      .filter((r) => !r.isSystem)
      .sort((a, b) => a.name.localeCompare(b.name));

    return { success: true, data: [...system, ...custom].map(mapRole) };
  } catch (err) {
    console.error('[getRoles]', err);
    return { success: false, error: 'Failed to load roles.' };
  }
}

export async function getRole(
  roleId: string,
): Promise<ActionResult<RoleWithDetails>> {
  try {
    const ctx = await getOrganizationContext();

    const role = await prisma.role.findFirst({
      where: { id: roleId, organizationId: ctx.organization.id },
      select: ROLE_SELECT,
    });

    if (!role) return { success: false, error: 'Role not found.' };

    return { success: true, data: mapRole(role) };
  } catch (err) {
    console.error('[getRole]', err);
    return { success: false, error: 'Failed to load role.' };
  }
}

export async function createRole(
  input: z.infer<typeof CreateRoleSchema>,
): Promise<ActionResult<{ roleId: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.ROLE_MANAGE);

    const parsed = CreateRoleSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const { name, description, permissionKeys } = parsed.data;

    // Invariant 3: caller cannot grant permissions they don't hold
    const forbidden = permissionKeys.filter(
      (k) => !hasPermission(ctx.membership.role.permissions, k),
    );
    if (forbidden.length > 0) {
      return {
        success: false,
        error: `You don't hold these permissions and cannot grant them: ${forbidden.join(', ')}`,
      };
    }

    // Name uniqueness (case-insensitive) within org
    const existing = await prisma.role.findFirst({
      where: {
        organizationId: ctx.organization.id,
        name: { equals: name, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existing) {
      return { success: false, error: `A role named "${name}" already exists.` };
    }

    // Fetch permission IDs by key
    const permissions = await prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
      select: { id: true },
    });

    const role = await prisma.role.create({
      data: {
        organizationId: ctx.organization.id,
        name,
        description: description ?? null,
        isSystem: false,
        rolePermissions: {
          createMany: {
            data: permissions.map((p) => ({ permissionId: p.id })),
          },
        },
      },
      select: { id: true },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'role.created',
      entityType: 'Role',
      entityId: role.id,
      metadata: { name, permissionCount: permissions.length },
    });

    return { success: true, data: { roleId: role.id } };
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return { success: false, error: 'You do not have permission to manage roles.' };
    }
    console.error('[createRole]', err);
    return { success: false, error: 'Failed to create role. Please try again.' };
  }
}

export async function updateRole(
  input: z.infer<typeof UpdateRoleSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.ROLE_MANAGE);

    const parsed = UpdateRoleSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const { roleId, name, description, permissionKeys } = parsed.data;

    // Verify role belongs to this org
    const role = await prisma.role.findFirst({
      where: { id: roleId, organizationId: ctx.organization.id },
      select: { id: true, name: true, isSystem: true },
    });
    if (!role) return { success: false, error: 'Role not found.' };

    // Invariant 3: caller cannot grant permissions they don't hold
    if (permissionKeys) {
      const forbidden = permissionKeys.filter(
        (k) => !hasPermission(ctx.membership.role.permissions, k),
      );
      if (forbidden.length > 0) {
        return {
          success: false,
          error: `You don't hold these permissions and cannot grant them: ${forbidden.join(', ')}`,
        };
      }
    }

    // Name uniqueness (excluding this role)
    if (name && name.toLowerCase() !== role.name.toLowerCase()) {
      const conflict = await prisma.role.findFirst({
        where: {
          organizationId: ctx.organization.id,
          name: { equals: name, mode: 'insensitive' },
          NOT: { id: roleId },
        },
        select: { id: true },
      });
      if (conflict) {
        return { success: false, error: `A role named "${name}" already exists.` };
      }
    }

    // Transaction: atomically replace permissions + update metadata
    await prisma.$transaction(async (tx) => {
      if (permissionKeys !== undefined) {
        const permissions = await tx.permission.findMany({
          where: { key: { in: permissionKeys } },
          select: { id: true },
        });

        await tx.rolePermission.deleteMany({ where: { roleId } });
        if (permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: permissions.map((p) => ({ roleId, permissionId: p.id })),
          });
        }
      }

      const updateData: { name?: string; description?: string | null } = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;

      if (Object.keys(updateData).length > 0) {
        await tx.role.update({ where: { id: roleId }, data: updateData });
      }
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'role.updated',
      entityType: 'Role',
      entityId: roleId,
      metadata: {
        name: name ?? role.name,
        permissionCount: permissionKeys?.length,
      },
    });

    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return { success: false, error: 'You do not have permission to manage roles.' };
    }
    console.error('[updateRole]', err);
    return { success: false, error: 'Failed to update role. Please try again.' };
  }
}

export async function deleteRole(roleId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.ROLE_MANAGE);

    const role = await prisma.role.findFirst({
      where: { id: roleId, organizationId: ctx.organization.id },
      select: {
        id: true,
        name: true,
        isSystem: true,
        _count: { select: { memberships: { where: { status: 'ACTIVE' } } } },
      },
    });

    if (!role) return { success: false, error: 'Role not found.' };

    // Invariant 2: cannot delete system roles
    if (role.isSystem) {
      return { success: false, error: 'System roles cannot be deleted.' };
    }

    // Invariant 1: cannot delete role with active members
    if (role._count.memberships > 0) {
      return {
        success: false,
        error: `Reassign ${role._count.memberships} member${role._count.memberships !== 1 ? 's' : ''} before deleting this role.`,
      };
    }

    await prisma.role.delete({ where: { id: roleId } });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'role.deleted',
      entityType: 'Role',
      entityId: roleId,
      metadata: { name: role.name },
    });

    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return { success: false, error: 'You do not have permission to manage roles.' };
    }
    console.error('[deleteRole]', err);
    return { success: false, error: 'Failed to delete role. Please try again.' };
  }
}

export async function duplicateRole(
  roleId: string,
  newName: string,
): Promise<ActionResult<{ roleId: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.ROLE_MANAGE);

    if (!newName || newName.trim().length < 2) {
      return { success: false, error: 'Role name must be at least 2 characters.' };
    }
    if (newName.trim().length > 50) {
      return { success: false, error: 'Role name must be 50 characters or less.' };
    }

    const source = await prisma.role.findFirst({
      where: { id: roleId, organizationId: ctx.organization.id },
      select: {
        id: true,
        name: true,
        description: true,
        rolePermissions: {
          select: { permission: { select: { id: true, key: true } } },
        },
      },
    });

    if (!source) return { success: false, error: 'Source role not found.' };

    const sourcePermissionKeys = source.rolePermissions.map((rp) => rp.permission.key);

    // Invariant 3: caller cannot duplicate permissions they don't hold
    const forbidden = sourcePermissionKeys.filter(
      (k) => !hasPermission(ctx.membership.role.permissions, k as PermissionKey),
    );
    if (forbidden.length > 0) {
      return {
        success: false,
        error: `Cannot duplicate role: you don't hold these permissions: ${forbidden.join(', ')}`,
      };
    }

    // Name uniqueness
    const trimmedName = newName.trim();
    const conflict = await prisma.role.findFirst({
      where: {
        organizationId: ctx.organization.id,
        name: { equals: trimmedName, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (conflict) {
      return { success: false, error: `A role named "${trimmedName}" already exists.` };
    }

    const permissionIds = source.rolePermissions.map((rp) => rp.permission.id);

    const newRole = await prisma.role.create({
      data: {
        organizationId: ctx.organization.id,
        name: trimmedName,
        description: source.description,
        isSystem: false,
        rolePermissions: {
          createMany: {
            data: permissionIds.map((id) => ({ permissionId: id })),
          },
        },
      },
      select: { id: true },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'role.duplicated',
      entityType: 'Role',
      entityId: newRole.id,
      metadata: { sourceRoleId: roleId, newName: trimmedName },
    });

    return { success: true, data: { roleId: newRole.id } };
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return { success: false, error: 'You do not have permission to manage roles.' };
    }
    console.error('[duplicateRole]', err);
    return { success: false, error: 'Failed to duplicate role. Please try again.' };
  }
}
