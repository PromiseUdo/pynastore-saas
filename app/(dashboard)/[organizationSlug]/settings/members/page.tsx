import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { MembersTable } from '@/components/members/members-table';
import { InvitationsTable } from '@/components/members/invitations-table';
import { InviteMemberButton } from '@/components/members/invite-member-button';

export default async function MembersPage() {
  const ctx = await getOrganizationContext();

  const canView = hasPermission(ctx.membership.role.permissions, PERMISSIONS.STAFF_VIEW);
  if (!canView) redirect('/settings');

  const canManage = hasPermission(ctx.membership.role.permissions, PERMISSIONS.STAFF_MANAGE);
  const canInvite = hasPermission(ctx.membership.role.permissions, PERMISSIONS.STAFF_INVITE);

  // Fetch active members
  const memberships = await prisma.membership.findMany({
    where: {
      organizationId: ctx.organization.id,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      joinedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
      role: {
        select: { id: true, name: true },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  // Fetch pending invitations
  const invitations = await prisma.invitation.findMany({
    where: {
      organizationId: ctx.organization.id,
      status: 'PENDING',
    },
    select: {
      id: true,
      email: true,
      roleId: true,
      status: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Fetch roles for the invite dialog and role selector
  const roles = await prisma.role.findMany({
    where: { organizationId: ctx.organization.id },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  // Build a role map for invitations (roleId → role object)
  const roleMap = new Map(roles.map((r) => [r.id, r]));

  const memberRows = memberships.map((m) => ({
    id: m.id,
    user: m.user,
    role: m.role,
    joinedAt: m.joinedAt,
  }));

  const invitationRows = invitations.map((inv) => ({
    id: inv.id,
    email: inv.email,
    role: roleMap.get(inv.roleId) ?? { id: inv.roleId, name: 'Unknown' },
    createdAt: inv.createdAt,
    expiresAt: inv.expiresAt,
    status: inv.status as 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED',
  }));

  return (
    <>
      <PageHeader
        title="Team Members"
        description={`${memberRows.length} active member${memberRows.length !== 1 ? 's' : ''}`}
        actions={canInvite ? <InviteMemberButton roles={roles} /> : undefined}
      />

      <PageBody className="space-y-8">
        {/* Active members */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Members</h2>
          <MembersTable
            members={memberRows}
            roles={roles}
            currentUserId={ctx.userId}
            canManage={canManage}
          />
        </section>

        {/* Pending invitations */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Pending Invitations
            {invitationRows.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({invitationRows.length})
              </span>
            )}
          </h2>
          <InvitationsTable
            invitations={invitationRows}
            canManage={canInvite}
          />
        </section>
      </PageBody>
    </>
  );
}
