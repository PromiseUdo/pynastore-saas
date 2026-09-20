import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { getRole, getRoles } from '@/features/roles/actions';
import { RolesPageClient } from '../_components/RolesPageClient';
import { RoleDeepLinkClient } from './_components/RoleDeepLinkClient';
import { ShieldOff } from 'lucide-react';

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
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
          <ShieldOff className="size-6 text-muted-foreground" />
        </div>
        <h2 className="text-base font-semibold text-foreground">Access denied</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You don&apos;t have permission to manage roles.
        </p>
      </div>
    );
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
