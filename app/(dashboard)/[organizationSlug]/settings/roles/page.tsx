import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { getRoles } from '@/features/roles/actions';
import { RolesPageClient } from './_components/RolesPageClient';
import { ShieldOff } from 'lucide-react';

export default async function RolesPage() {
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
        <h2 className="text-base font-semibold text-foreground">
          Access denied
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You don&apos;t have permission to manage roles.
        </p>
      </div>
    );
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
