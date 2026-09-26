import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { getRole, getRoles } from '@/features/roles/actions';
import { RolesPageClient } from '../_components/RolesPageClient';
import { RoleDeepLinkClient } from './_components/RoleDeepLinkClient';

type Props = {
  params: Promise<{ organizationSlug: string; roleId: string }>;
};

export default async function RoleDetailPage({ params }: Props) {
  const { roleId } = await params;
  const ctx = await getOrganizationContext();

  const canManage = hasPermission(
    ctx.membership.role.permissions,
    PERMISSIONS.ROLE_MANAGE,
  );

  if (!canManage) {
    return <AccessDenied what="roles and permissions" />;
  }

  const [rolesResult, roleResult] = await Promise.all([
    getRoles(),
    getRole(roleId),
  ]);

  if (!rolesResult.success) {
    throw new Error(rolesResult.error);
  }

  if (!roleResult.success) {
    notFound();
  }

  return (
    <RoleDeepLinkClient
      roles={rolesResult.data}
      targetRole={roleResult.data}
      callerPermissions={ctx.membership.role.permissions}
      organizationSlug={ctx.organization.slug}
    />
  );
}
