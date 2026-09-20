'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { getOrganizationContext } from '@/lib/organization';
import {
  requirePermission,
  PERMISSIONS,
  PermissionDeniedError,
} from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { requireSeatAvailable, UsageLimitExceededError } from '@/lib/billing/entitlements';
import { sendInvitationEmail } from '@/lib/email';
import { updateCurrentOrganization } from '@/lib/session';
import { getAdminUrl, getMarketingUrl } from '@/lib/tenant/urls';
import { z } from 'zod';

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

const SendInvitationSchema = z.object({
  email: z.email(),
  roleId: z.string().min(1, 'Role is required'),
});

/**
 * Send an invitation email to a new team member.
 * Requires STAFF_INVITE permission.
 */
export async function sendInvitation(
  input: z.infer<typeof SendInvitationSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(
      ctx.membership.role.permissions,
      PERMISSIONS.STAFF_INVITE,
    );
    await requireSeatAvailable();

    const parsed = SendInvitationSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const { email, roleId } = parsed.data;

    // Verify the role belongs to this organization
    const role = await prisma.role.findFirst({
      where: { id: roleId, organizationId: ctx.organization.id },
      select: { id: true, name: true },
    });

    if (!role) {
      return { success: false, error: 'Invalid role.' };
    }

    // Check if the email is already an active member
    const existingMember = await prisma.membership.findFirst({
      where: {
        organizationId: ctx.organization.id,
        status: 'ACTIVE',
        user: { email },
      },
      select: { id: true },
    });

    if (existingMember) {
      return {
        success: false,
        error: 'This person is already a member of your organization.',
      };
    }

    // Check for a pending invitation
    const pendingInvite = await prisma.invitation.findFirst({
      where: {
        organizationId: ctx.organization.id,
        email,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    if (pendingInvite) {
      return {
        success: false,
        error: 'A pending invitation already exists for this email.',
      };
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invitation = await prisma.invitation.create({
      data: {
        organizationId: ctx.organization.id,
        email,
        roleId: role.id,
        status: 'PENDING',
        expiresAt,
        invitedById: ctx.userId,
      },
      select: { id: true, token: true },
    });

    // Fetch inviter name for the email
    const inviter = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { name: true, email: true },
    });

    const inviteUrl = getMarketingUrl(`/invite/${invitation.token}`);

    await sendInvitationEmail({
      to: email,
      orgName: ctx.organization.name,
      inviterName: inviter?.name ?? inviter?.email ?? 'A teammate',
      role: role.name,
      inviteUrl,
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'staff.invitation.sent',
      entityType: 'Invitation',
      entityId: invitation.id,
      metadata: { email, roleId: role.id, roleName: role.name },
    });

    revalidatePath(`/${ctx.organization.slug}/settings/members`);
    return { success: true, data: { id: invitation.id } };
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return {
        success: false,
        error: 'You do not have permission to invite members.',
      };
    }
    if (err instanceof UsageLimitExceededError) {
      return {
        success: false,
        error: `Your plan is limited to ${err.limit} team seats. Upgrade to invite more people.`,
      };
    }
    console.error('[sendInvitation]', err);
    return {
      success: false,
      error: 'Failed to send invitation. Please try again.',
    };
  }
}

/**
 * Accept an invitation by token.
 * Derives org + role entirely from the token — never trusts client-provided IDs.
 * If the user isn't signed in, redirects to /login with the invite token preserved.
 */
export async function acceptInvitation(token: string): Promise<ActionResult> {
  const session = await auth();

  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/invite/${encodeURIComponent(token)}`);
  }

  try {
    const invitation = await prisma.invitation.findUnique({
      where: { token },
      select: {
        id: true,
        email: true,
        roleId: true,
        organizationId: true,
        status: true,
        expiresAt: true,
        organization: {
          select: { id: true, slug: true, name: true, status: true },
        },
      },
    });

    if (!invitation) {
      return { success: false, error: 'Invitation not found.' };
    }

    if (invitation.status !== 'PENDING') {
      return {
        success: false,
        error: `This invitation has already been ${invitation.status.toLowerCase()}.`,
      };
    }

    if (invitation.expiresAt < new Date()) {
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });
      return { success: false, error: 'This invitation has expired.' };
    }

    if (invitation.organization.status !== 'ACTIVE') {
      return {
        success: false,
        error: 'This organization is no longer active.',
      };
    }

    // Check if already a member
    const existingMembership = await prisma.membership.findFirst({
      where: {
        userId: session.user.id,
        organizationId: invitation.organizationId,
      },
      select: { id: true, status: true },
    });

    if (existingMembership) {
      if (existingMembership.status === 'ACTIVE') {
        // Already a member — idempotent: just switch session to this org and redirect
        await updateCurrentOrganization(
          session.user.id,
          invitation.organization.id,
          invitation.organization.slug,
        );
        redirect(getAdminUrl(invitation.organization.slug, '/dashboard'));
      }
      // Reactivate suspended membership
      await prisma.$transaction([
        prisma.membership.update({
          where: { id: existingMembership.id },
          data: { status: 'ACTIVE', roleId: invitation.roleId },
        }),
        prisma.invitation.update({
          where: { id: invitation.id },
          data: { status: 'ACCEPTED' },
        }),
      ]);
    } else {
      await prisma.$transaction([
        prisma.membership.create({
          data: {
            userId: session.user.id,
            organizationId: invitation.organizationId,
            roleId: invitation.roleId,
            status: 'ACTIVE',
          },
        }),
        prisma.invitation.update({
          where: { id: invitation.id },
          data: { status: 'ACCEPTED' },
        }),
      ]);
    }

    await createAuditLog({
      organizationId: invitation.organizationId,
      userId: session.user.id,
      action: 'staff.invitation.accepted',
      entityType: 'Invitation',
      entityId: invitation.id,
      metadata: { inviteeEmail: invitation.email },
    });

    await updateCurrentOrganization(
      session.user.id,
      invitation.organization.id,
      invitation.organization.slug,
    );

    redirect(getAdminUrl(invitation.organization.slug, '/dashboard'));
  } catch (err) {
    // Re-throw Next.js redirect
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
    console.error('[acceptInvitation]', err);
    return {
      success: false,
      error: 'Failed to accept invitation. Please try again.',
    };
  }
}

/**
 * Revoke a pending invitation.
 * Requires STAFF_INVITE permission.
 */
export async function revokeInvitation(
  invitationId: string,
): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(
      ctx.membership.role.permissions,
      PERMISSIONS.STAFF_INVITE,
    );

    const invitation = await prisma.invitation.findFirst({
      where: { id: invitationId, organizationId: ctx.organization.id },
      select: { id: true, status: true, email: true },
    });

    if (!invitation) {
      return { success: false, error: 'Invitation not found.' };
    }

    if (invitation.status !== 'PENDING') {
      return {
        success: false,
        error: 'Only pending invitations can be revoked.',
      };
    }

    await prisma.invitation.update({
      where: { id: invitationId },
      data: { status: 'REVOKED' },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'staff.invitation.revoked',
      entityType: 'Invitation',
      entityId: invitationId,
      metadata: { email: invitation.email },
    });

    revalidatePath(`/${ctx.organization.slug}/settings/members`);
    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return {
        success: false,
        error: 'You do not have permission to revoke invitations.',
      };
    }
    console.error('[revokeInvitation]', err);
    return {
      success: false,
      error: 'Failed to revoke invitation. Please try again.',
    };
  }
}

/**
 * Resend an invitation by regenerating its token and resetting the expiry.
 * Requires STAFF_INVITE permission.
 */
export async function resendInvitation(
  invitationId: string,
): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(
      ctx.membership.role.permissions,
      PERMISSIONS.STAFF_INVITE,
    );

    const invitation = await prisma.invitation.findFirst({
      where: { id: invitationId, organizationId: ctx.organization.id },
      select: {
        id: true,
        email: true,
        status: true,
        roleId: true,
      },
    });

    if (!invitation) {
      return { success: false, error: 'Invitation not found.' };
    }

    if (invitation.status !== 'PENDING') {
      return {
        success: false,
        error: 'Only pending invitations can be resent.',
      };
    }

    const newToken = crypto.randomUUID().replace(/-/g, '');
    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 7);

    const role = await prisma.role.findUnique({
      where: { id: invitation.roleId },
      select: { name: true },
    });

    const updated = await prisma.invitation.update({
      where: { id: invitationId },
      data: { token: newToken, expiresAt: newExpiresAt },
      select: { token: true },
    });

    const inviter = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { name: true, email: true },
    });

    const inviteUrl = getMarketingUrl(`/invite/${updated.token}`);

    await sendInvitationEmail({
      to: invitation.email,
      orgName: ctx.organization.name,
      inviterName: inviter?.name ?? inviter?.email ?? 'A teammate',
      role: role?.name ?? 'Team Member',
      inviteUrl,
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'staff.invitation.resent',
      entityType: 'Invitation',
      entityId: invitationId,
      metadata: { email: invitation.email },
    });

    revalidatePath(`/${ctx.organization.slug}/settings/members`);
    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return {
        success: false,
        error: 'You do not have permission to resend invitations.',
      };
    }
    console.error('[resendInvitation]', err);
    return {
      success: false,
      error: 'Failed to resend invitation. Please try again.',
    };
  }
}
