import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { getRoles } from '@/features/roles/actions';
import { RolesPageClient } from './_components/RolesPageClient';

export default async function RolesPage() {
  const ctx = await getOrganizationContext();

  const canManage = hasPermission(
    ctx.membership.role.permissions,
    PERMISSIONS.ROLE_MANAGE,
  );

  if (!canManage) {
    return <AccessDenied what="roles and permissions" />;
  }

  const rolesResult = await getRoles();

  if (!rolesResult.success) {
    throw new Error(rolesResult.error);
  }

  return (
    <RolesPageClient
      roles={rolesResult.data}
      callerPermissions={ctx.membership.role.permissions}
      organizationSlug={ctx.organization.slug}
    />
  );
}
